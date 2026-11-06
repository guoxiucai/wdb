using System;
using System.IO;
using System.Text;
using System.Collections;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Threading;
using System.Web.Script.Serialization;

// One process, one ConPTY, one kill-on-close Job. stdout is framed binary IPC.
internal sealed class PtyHost {
 const int Window=262144, MaxBinary=65536, MaxControl=16384;
 static readonly JavaScriptSerializer Json=new JavaScriptSerializer { MaxJsonLength=MaxControl, RecursionLimit=20 };
 readonly Stream ipcIn=Console.OpenStandardInput(), ipcOut=Console.OpenStandardOutput();
 readonly object outputLock=new object(), gate=new object();
 readonly ManualResetEvent done=new ManualResetEvent(false), outputEnded=new ManualResetEvent(false);
 readonly AutoResetEvent inputReady=new AutoResetEvent(false);
 readonly ConcurrentQueue<byte[]> inputQueue=new ConcurrentQueue<byte[]>();
 IntPtr pty=IntPtr.Zero, job=IntPtr.Zero, inputWrite=IntPtr.Zero, outputRead=IntPtr.Zero, process=IntPtr.Zero;
 volatile bool closing, started, failed; bool opened; long lastRequest,sent,peerConsumed,received,consumed; long closeRequest;
 string closeReason,sessionId=Guid.NewGuid().ToString(),program,executable,arguments,cwd; IntPtr environment=IntPtr.Zero; short cols,rows;
 Thread reader,writer; Dictionary<string,object> execution;
 [StructLayout(LayoutKind.Sequential)] struct Coord { public short X,Y; public Coord(short x,short y){X=x;Y=y;} }
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct StartupInfo { public uint cb;public string reserved,desktop,title;public uint x,y,xSize,ySize,xChars,yChars,fill,flags;public ushort show,cbReserved;public IntPtr reserved2,stdInput,stdOutput,stdError; }
 [StructLayout(LayoutKind.Sequential)] struct StartupInfoEx {public StartupInfo startup;public IntPtr attributes;}
 [StructLayout(LayoutKind.Sequential)] struct ProcessInfo {public IntPtr process,thread;public uint pid,tid;}
 [StructLayout(LayoutKind.Sequential)] struct BasicLimits {public long perProcess,perJob;public uint flags;public UIntPtr minWork,maxWork;public uint active;public UIntPtr affinity;public uint priority,scheduling;}
 [StructLayout(LayoutKind.Sequential)] struct IoCounters {public ulong readOps,writeOps,otherOps,readBytes,writeBytes,otherBytes;}
 [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {public BasicLimits basic;public IoCounters io;public UIntPtr processMemory,jobMemory,peakProcess,peakJob;}
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool CreatePipe(out IntPtr read,out IntPtr write,IntPtr security,uint size);
 [DllImport("kernel32.dll")] static extern int CreatePseudoConsole(Coord size,IntPtr input,IntPtr output,uint flags,out IntPtr console);
 [DllImport("kernel32.dll")] static extern int ResizePseudoConsole(IntPtr console,Coord size);
 [DllImport("kernel32.dll")] static extern void ClosePseudoConsole(IntPtr console);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,int flags,ref IntPtr size);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr attribute,IntPtr value,IntPtr size,IntPtr previous,IntPtr returned);
 [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcessW(string application,StringBuilder command,IntPtr processSecurity,IntPtr threadSecurity,bool inherit,uint flags,IntPtr env,string directory,ref StartupInfoEx startup,out ProcessInfo info);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr security,string name);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,ref ExtendedLimits info,uint length);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
 [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint exitCode);
 [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle,uint ms);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool ReadFile(IntPtr handle,byte[] buffer,int count,out int read,IntPtr overlapped);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool WriteFile(IntPtr handle,byte[] buffer,int count,out int written,IntPtr overlapped);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 static Dictionary<string,object> Map(params object[] pairs){var d=new Dictionary<string,object>();for(int i=0;i<pairs.Length;i+=2)d[(string)pairs[i]]=pairs[i+1];return d;}
 static void Require(bool value,string message){if(!value)throw new ArgumentException(message);}
 static string Text(Dictionary<string,object> m,string k){object value;Require(m.TryGetValue(k,out value)&&value is string,"Missing/string field "+k);return (string)value;}
 static long Number(Dictionary<string,object> m,string k,long min,long max){object value;Require(m.TryGetValue(k,out value)&&(value is int||value is long||value is decimal),"Integer field "+k);decimal n=Convert.ToDecimal(value);Require(n>=min&&n<=max&&Decimal.Truncate(n)==n,"Invalid "+k);return (long)n;}
 static void Keys(Dictionary<string,object> m,params string[] keys){foreach(string k in m.Keys)Require(Array.IndexOf(keys,k)>=0,"Unknown field "+k);}
 void Frame(byte kind,byte[] bytes){lock(outputLock){byte[] h=new byte[5];h[0]=kind;Buffer.BlockCopy(BitConverter.GetBytes(bytes.Length),0,h,1,4);ipcOut.Write(h,0,5);ipcOut.Write(bytes,0,bytes.Length);ipcOut.Flush();}}
 void Control(Dictionary<string,object> m){lock(outputLock)Frame(1,Encoding.UTF8.GetBytes(Json.Serialize(m)));}
 void Fail(string code,string message){if(failed)return;failed=true;try{Control(Map("type","error","code",code,"message",message.Length>2000?message.Substring(0,2000):message));}catch{}Stop();}
 void Stop(){closing=true;lock(gate)Monitor.PulseAll(gate);inputReady.Set();done.Set();}
 bool ReadExact(byte[] b,int n){int p=0;while(p<n){int read=ipcIn.Read(b,p,n-p);if(read==0)return false;p+=read;}return true;}
 void ReadLoop(){try{while(!closing){byte[] h=new byte[5];if(!ReadExact(h,5)){Stop();return;}uint length=BitConverter.ToUInt32(h,1);Require((h[0]==1&&length<=MaxControl)||(h[0]==2&&length<=MaxBinary),"Invalid IPC frame length/kind");byte[] data=new byte[(int)length];Require(ReadExact(data,data.Length),"Truncated IPC frame");if(h[0]==1){var parser=new JavaScriptSerializer { MaxJsonLength=MaxControl,RecursionLimit=20 };var m=parser.Deserialize<Dictionary<string,object>>(new UTF8Encoding(false,true).GetString(data));Message(m);}else{Require(started,"Data before ready");lock(gate){Require(received+data.Length-consumed<=Window,"Input window exceeded");received+=data.Length;}inputQueue.Enqueue(data);inputReady.Set();}}}catch(Exception e){if(!closing)Fail(e is ArgumentException?"INVALID_ARGUMENT":"PTY_UNAVAILABLE",e.Message);}}
 void Message(Dictionary<string,object> m){
  string type=Text(m,"type");
  if(type=="credit"){Keys(m,"type","consumed");long value=Number(m,"consumed",0,9007199254740991);lock(gate){Require(value>=peerConsumed&&value<=sent,"Invalid output credit");peerConsumed=value;Monitor.PulseAll(gate);}return;}
  long request=Number(m,"requestId",1,9007199254740991);Require(request>lastRequest,"Duplicate requestId");lastRequest=request;
  if(type=="close"){Keys(m,"type","requestId","reason");closeReason=Text(m,"reason");Require(closeReason=="client_close"||closeReason=="client_interrupt","Invalid close reason");closeRequest=request;Stop();return;}
  if(type=="open"){
   Keys(m,"type","requestId","kind","program","admin","env","terminal","cwd");Require(!opened&&!started,"Duplicate open");Require(Text(m,"kind")=="shell","Only shell IPC is supported");Prepare(m);opened=true;Control(Map("type","opened","replyTo",request,"kind","shell","sessionId",sessionId,"program",program,"backend","conpty","execution",execution));return;
  }
  if(type=="ready"){Keys(m,"type","requestId");Require(opened&&!started,"Unexpected ready");Start(request);return;}
  if(type=="resize"){Keys(m,"type","requestId","cols","rows");Require(started&&!closing,"Resize before ready");short x=(short)Number(m,"cols",1,1000),y=(short)Number(m,"rows",1,1000);int result=ResizePseudoConsole(pty,new Coord(x,y));if(result<0)Marshal.ThrowExceptionForHR(result);cols=x;rows=y;Control(Map("type","resize.ack","replyTo",request,"cols",(int)x,"rows",(int)y));return;}
  throw new ArgumentException("Unknown IPC control message");
 }
 void Prepare(Dictionary<string,object> m){
  program=Text(m,"program");string system=Environment.GetFolderPath(Environment.SpecialFolder.System);
  if(program=="powershell"){executable=Path.Combine(system,@"WindowsPowerShell\v1.0\powershell.exe");arguments=" -NoLogo -NoProfile";}
  else if(program=="cmd"){executable=Path.Combine(system,"cmd.exe");arguments="";}
  else if(program=="pwsh"){executable=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),@"PowerShell\7\pwsh.exe");arguments=" -NoLogo -NoProfile";}
  else throw new ArgumentException("Unsupported program enum");
  if(!File.Exists(executable)){Fail("SHELL_NOT_FOUND","Requested shell is not installed at its fixed system path");throw new OperationCanceledException();}
  cwd=m.ContainsKey("cwd")?Text(m,"cwd"):Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);Require(cwd.Length>0&&cwd.IndexOf('\0')<0&&Path.IsPathRooted(cwd)&&Directory.Exists(cwd),"Shell working directory must exist and be absolute");cwd=Path.GetFullPath(cwd);
  var terminal=m["terminal"] as Dictionary<string,object>;Require(terminal!=null,"Invalid terminal");Keys(terminal,"cols","rows","term");cols=(short)Number(terminal,"cols",1,1000);rows=(short)Number(terminal,"rows",1,1000);Require(Text(terminal,"term").Length<=64,"Invalid term");
  var supplied=m["env"] as Dictionary<string,object>;Require(supplied!=null&&supplied.Count<=128,"Invalid environment");var env=new SortedDictionary<string,string>(StringComparer.OrdinalIgnoreCase);foreach(DictionaryEntry e in Environment.GetEnvironmentVariables())env[(string)e.Key]=(string)e.Value;
  // An installer/development launcher may be a different PowerShell edition.
  // Let the selected shell establish its own default module search path and
  // policy instead of inheriting that launcher's process-only settings. Explicit
  // session environment entries below still have their documented meaning.
  if(program=="powershell"||program=="pwsh"){env.Remove("PSModulePath");env.Remove("PSExecutionPolicyPreference");}
  foreach(var e in supplied){Require(e.Key.Length>0&&e.Key.IndexOfAny(new char[]{'=','\0'})<0&&e.Value is string&&((string)e.Value).IndexOf('\0')<0,"Invalid environment field");env[e.Key]=(string)e.Value;}
  var block=new StringBuilder();foreach(var e in env)block.Append(e.Key).Append('=').Append(e.Value).Append('\0');block.Append('\0');Require(block.Length<=32767,"Environment block too large");environment=Marshal.StringToHGlobalUni(block.ToString());
  var identity=WindowsIdentity.GetCurrent();execution=Map("identity",identity.Name,"sid",identity.User.Value,"isElevated",new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator),"windowsSessionId",Process.GetCurrentProcess().SessionId);
  Require(m["admin"] is bool,"Invalid admin flag");if((bool)m["admin"]&&!(bool)execution["isElevated"])throw new ArgumentException("Admin backend is not elevated");
 }
 void Start(long request){
  IntPtr inputRead=IntPtr.Zero,outputWrite=IntPtr.Zero,attributes=IntPtr.Zero;ProcessInfo info=new ProcessInfo();
  try{
   if(!CreatePipe(out inputRead,out inputWrite,IntPtr.Zero,0)||!CreatePipe(out outputRead,out outputWrite,IntPtr.Zero,0))throw new Win32Exception();
   int hr=CreatePseudoConsole(new Coord(cols,rows),inputRead,outputWrite,0,out pty);if(hr<0)Marshal.ThrowExceptionForHR(hr);
   reader=new Thread(OutputLoop);reader.IsBackground=true;reader.Start();
   IntPtr size=IntPtr.Zero;InitializeProcThreadAttributeList(IntPtr.Zero,1,0,ref size);attributes=Marshal.AllocHGlobal(size);if(!InitializeProcThreadAttributeList(attributes,1,0,ref size))throw new Win32Exception();
   if(!UpdateProcThreadAttribute(attributes,0,new IntPtr(0x00020016),pty,new IntPtr(IntPtr.Size),IntPtr.Zero,IntPtr.Zero))throw new Win32Exception();
   job=CreateJobObject(IntPtr.Zero,null);if(job==IntPtr.Zero)throw new Win32Exception();var limits=new ExtendedLimits();limits.basic.flags=0x2000;if(!SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(ExtendedLimits))))throw new Win32Exception();
   var startup=new StartupInfoEx();startup.startup.cb=(uint)Marshal.SizeOf(typeof(StartupInfoEx));startup.attributes=attributes;
   // Suppress inheritance of this host's redirected IPC stdio. ConPTY supplies
   // the child's console handles; otherwise cmd can write unframed bytes here.
   startup.startup.flags=0x100;
   if(!CreateProcessW(executable,new StringBuilder("\""+executable+"\""+arguments),IntPtr.Zero,IntPtr.Zero,false,0x00080000|0x00000400|0x00000004,environment,cwd,ref startup,out info))throw new Win32Exception();
   process=info.process;if(!AssignProcessToJobObject(job,process)){TerminateProcess(process,1);throw new Win32Exception(Marshal.GetLastWin32Error(),"Cannot contain shell process tree in session Job");}
   started=true;Control(Map("type","ready.ack","replyTo",request,"sessionId",sessionId,"pid",info.pid,"execution",execution));
   if(ResumeThread(info.thread)==0xffffffff)throw new Win32Exception();
   writer=new Thread(InputLoop);writer.IsBackground=true;writer.Start();var waiter=new Thread(ProcessExit);waiter.IsBackground=true;waiter.Start();
  }finally{if(inputRead!=IntPtr.Zero)CloseHandle(inputRead);if(outputWrite!=IntPtr.Zero)CloseHandle(outputWrite);if(info.thread!=IntPtr.Zero)CloseHandle(info.thread);if(attributes!=IntPtr.Zero){DeleteProcThreadAttributeList(attributes);Marshal.FreeHGlobal(attributes);}if(environment!=IntPtr.Zero){Marshal.FreeHGlobal(environment);environment=IntPtr.Zero;}}
 }
 void InputLoop(){try{while(!closing){byte[] b;if(!inputQueue.TryDequeue(out b)){inputReady.WaitOne(1000);continue;}int offset=0;while(offset<b.Length&&!closing){byte[] remaining=b;if(offset>0){remaining=new byte[b.Length-offset];Buffer.BlockCopy(b,offset,remaining,0,remaining.Length);}int n;if(!WriteFile(inputWrite,remaining,remaining.Length,out n,IntPtr.Zero)||n==0)throw new Win32Exception();offset+=n;}if(!closing){lock(gate)consumed+=b.Length;Control(Map("type","credit","consumed",consumed));}}}catch(Exception e){if(!closing)Fail("PTY_UNAVAILABLE",e.Message);}}
 void OutputLoop(){try{byte[] b=new byte[16384];int n;while(ReadFile(outputRead,b,b.Length,out n,IntPtr.Zero)&&n>0){lock(gate){while(!closing&&sent+n-peerConsumed>Window)Monitor.Wait(gate,1000);if(closing)continue;sent+=n;}byte[] data=new byte[n];Buffer.BlockCopy(b,0,data,0,n);Frame(2,data);}}catch(Exception e){if(!closing)Fail("PTY_UNAVAILABLE",e.Message);}finally{outputEnded.Set();}}
 void ClosePty(){IntPtr p=Interlocked.Exchange(ref pty,IntPtr.Zero);if(p!=IntPtr.Zero)ClosePseudoConsole(p);}
 void ProcessExit(){try{WaitForSingleObject(process,0xffffffff);if(closing)return;uint code;if(!GetExitCodeProcess(process,out code))throw new Win32Exception();var close=new Thread(ClosePty);close.IsBackground=true;close.Start();var elapsed=Stopwatch.StartNew();if(!outputEnded.WaitOne(10000)){Fail("OUTPUT_DRAIN_TIMEOUT","ConPTY output did not finish after process exit");return;}lock(gate){while(!closing&&peerConsumed<sent&&elapsed.ElapsedMilliseconds<10000)Monitor.Wait(gate,100);if(closing)return;if(peerConsumed<sent){Fail("OUTPUT_DRAIN_TIMEOUT","Terminal consumer did not drain output");return;}}Control(Map("type","exit","sessionId",sessionId,"exitCode",code,"reason","process_exit"));Stop();}catch(Exception e){if(!closing)Fail("PTY_UNAVAILABLE",e.Message);}}
 void Cleanup(){closing=true;lock(gate)Monitor.PulseAll(gate);inputReady.Set();IntPtr j=Interlocked.Exchange(ref job,IntPtr.Zero);if(j!=IntPtr.Zero)CloseHandle(j);if(process!=IntPtr.Zero&&WaitForSingleObject(process,0)==0x102)TerminateProcess(process,1);var close=new Thread(ClosePty);close.IsBackground=true;close.Start();close.Join(8000);if(inputWrite!=IntPtr.Zero)CloseHandle(inputWrite);if(outputRead!=IntPtr.Zero)CloseHandle(outputRead);if(process!=IntPtr.Zero)CloseHandle(process);if(environment!=IntPtr.Zero)Marshal.FreeHGlobal(environment);}
 int Run(){Control(Map("type","hello","version",1,"ipcVersion",1,"deviceId","0000000000000000","serverInstanceId",Guid.NewGuid().ToString(),"channelId",Guid.NewGuid().ToString(),"limits",Map("binaryMessageBytes",MaxBinary,"controlMessageBytes",MaxControl,"windowBytes",Window,"leaseIntervalMs",5000,"leaseTimeoutMs",30000)));var input=new Thread(ReadLoop);input.IsBackground=true;input.Start();done.WaitOne();Cleanup();if(closeRequest>0&&!failed){try{Control(Map("type","closed","replyTo",closeRequest,"reason",closeReason));}catch{}}return failed?1:0;}
 public static int Main(){try{return new PtyHost().Run();}catch(Exception e){Console.Error.WriteLine(e.GetType().Name+": "+e.Message);return 1;}}
}

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using System.Runtime.InteropServices;
using N=MediaNative;

[assembly:System.Runtime.Versioning.TargetFramework(".NETFramework,Version=v4.8")]
internal static class CaptureHost {
 static volatile bool stop;static readonly JavaScriptSerializer Json=new JavaScriptSerializer();
 [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
 static object Get(Dictionary<string,object> a,string key,object fallback){object v;return a.TryGetValue(key,out v)?v:fallback;}
 [MTAThread] static int Main(string[] args){Console.OutputEncoding=new UTF8Encoding(false);bool mf=false;try{
  if(args.Length!=1)throw new Exception("Expected request JSON file");var a=Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(args[0]));
  N.Check(N.MFStartup(0x20070,0));mf=true;string op=Convert.ToString(Get(a,"op","record"));object result;
  if(op=="verify")result=MediaVerifier.Verify(Convert.ToString(a["path"]));
  else {
   if(Process.GetCurrentProcess().SessionId==0)throw new Exception("DESKTOP_UNAVAILABLE");SetProcessDpiAwarenessContext(new IntPtr(-4));
   int monitor=Convert.ToInt32(Get(a,"monitor",0));var screens=Screen.AllScreens;if(monitor<0||monitor>=screens.Length)throw new Exception("MONITOR_NOT_FOUND");
   using(var capture=new DesktopCapture(screens[monitor].DeviceName,Convert.ToInt32(Get(a,"captureIndex",-1)))){
    if(op=="probe"){string probePath=Convert.ToString(a["path"]);try{using(var probeWriter=Mp4Writer.Open(probePath,30,false)){} }finally{if(File.Exists(probePath))File.Delete(probePath);}result=new {available=true,backend="native",capture="dxgi",encoder="media-foundation",audio=false,monitorMappingVerified=true};}
    else {
     string file=Convert.ToString(a["path"]);int fps=Convert.ToInt32(Get(a,"fps",30));double seconds=Convert.ToDouble(Get(a,"durationSeconds",600));if(fps<1||fps>60||seconds<1||seconds>3600)throw new Exception("INVALID_ARGUMENT");
     long maxBytes=Convert.ToInt64(Get(a,"maxBytes",1073741824L));int parentId=Convert.ToInt32(Get(a,"parentPid",0));Process parent=parentId>0?Process.GetProcessById(parentId):null;string stopReason="duration_limit";
     var input=new Thread(delegate(){try{while(true){int c=Console.In.Read();if(c<0||c=='\n'){stop=true;return;}}}catch{stop=true;}});input.IsBackground=true;input.Start();
     long frames=0,written=0,captured=0,duplicated=0,dropped=0;bool? hardware=null;string encoder=null,fallback=null;var clock=Stopwatch.StartNew();
     using(var writer=Mp4Writer.Open(file,fps,Convert.ToString(Get(a,"encoder","auto"))=="software")){hardware=writer.HardwareAccelerated;encoder=writer.Encoder;fallback=writer.FallbackReason;clock.Restart();byte[] pixels=null;while(!stop&&clock.Elapsed.TotalSeconds<seconds){if(parent!=null&&parent.HasExited){stopReason="parent_exited";break;}if(File.Exists(file)&&new FileInfo(file).Length>maxBytes)throw new Exception("ARTIFACT_SPACE_EXHAUSTED");if(new DriveInfo(Path.GetPathRoot(file)).AvailableFreeSpace<32*1024*1024)throw new Exception("DISK_SPACE_EXHAUSTED");long due=(long)(clock.Elapsed.TotalSeconds*fps);if(frames>due){Thread.Sleep(1);continue;}bool fresh=capture.Capture();if(fresh){captured++;pixels=capture.Frame();}if(pixels==null){if(clock.Elapsed.TotalSeconds>5)throw new Exception("CAPTURE_TIMEOUT");Thread.Sleep(1);continue;}if(!fresh)duplicated++;long index=Math.Max(frames,due);dropped+=index-frames;writer.Write(pixels,index*10000000/fps,10000000/fps);frames=index+1;written++;}if(frames==0)throw new Exception("EMPTY_RECORDING");writer.Finish();}
     result=new {backend="native",captureMethod="DXGI Desktop Duplication",captureIndex=capture.CaptureIndex,monitorMappingVerified=true,encoder=encoder,hardwareAccelerated=hardware,encoderFallback=fallback,pixelConversion=capture.Conversion,conversionFallback=capture.ConversionFallback,audioStreams=0,finalized=true,statistics=new {capturedFrames=captured,outputFrames=written,duplicatedFrames=duplicated,droppedFrames=dropped},stopReason=stop?"control_closed":stopReason,video=MediaVerifier.Verify(file)};
    }
   }
  }
  Console.WriteLine(Json.Serialize(new {ok=true,data=result}));return 0;
 }catch(Exception e){Console.WriteLine(Json.Serialize(new {ok=false,error=new {code="NATIVE_RECORDING_FAILED",message=e.Message,hresult=e.HResult}}));return 1;}finally{if(mf)N.MFShutdown();}}
}

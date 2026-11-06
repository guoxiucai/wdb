using System;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Automation;
using System.Windows.Forms;

// A short-lived, interactive-session adapter. No GUI work is performed in Session 0.
public static class DesktopBridge {
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 64 * 1024 * 1024, RecursionLimit = 100 };
    sealed class Failure : Exception { public string Code; public Failure(string code, string message) : base(message) { Code = code; } }
    static Dictionary<string,object> D(object v) { return (Dictionary<string,object>)v; }
    static object[] A(object v) { return v is object[] ? (object[])v : ((ArrayList)v).ToArray(); }
    static object V(Dictionary<string,object> a,string k,object fallback=null) { object v; return a.TryGetValue(k,out v) ? v : fallback; }
    static string S(Dictionary<string,object> a,string k,string fallback="") { return Convert.ToString(V(a,k,fallback)); }
    static int I(Dictionary<string,object> a,string k,int fallback=0) { return Convert.ToInt32(V(a,k,fallback)); }
    static bool B(Dictionary<string,object> a,string k,bool fallback=false) { return Convert.ToBoolean(V(a,k,fallback)); }
    static void Require(bool ok,string code,string message) { if(!ok) throw new Failure(code,message); }
    static object Rect(Rectangle r) { return new { x=r.X,y=r.Y,width=r.Width,height=r.Height }; }
    static object Rect(System.Windows.Rect r) { return r.IsEmpty ? null : new { x=r.X,y=r.Y,width=r.Width,height=r.Height }; }
    static void Win(bool ok,string action) { if(!ok) throw new Failure("WIN32_ERROR",action+": "+new Win32Exception(Marshal.GetLastWin32Error()).Message); }

    [STAThread] public static int Main(string[] args) {
        Console.OutputEncoding = new UTF8Encoding(false);
        try {
            try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch(EntryPointNotFoundException) { SetProcessDPIAware(); }
            Require(args.Length==1,"INVALID_ARGUMENT","Expected request JSON file.");
            var req=D(Json.DeserializeObject(File.ReadAllText(args[0],Encoding.UTF8)));
            var a=V(req,"args")==null ? new Dictionary<string,object>() : D(req["args"]);
            string op=S(req,"op");object result;
            if(op.StartsWith("ui.")) {
                object value=null;Exception failure=null;
                var worker=new Thread(delegate(){try{Trace(a,"uia.begin");value=Run(op,a);Trace(a,"uia.completed");}catch(Exception error){failure=error;Trace(a,"uia.failed: "+error.GetType().Name);}});
                worker.SetApartmentState(ApartmentState.MTA);worker.Start();worker.Join();if(failure!=null)throw failure;result=value;
            } else result=Run(op,a);
            Console.WriteLine(Json.Serialize(new {ok=true,data=result})); return 0;
        } catch(Exception ex) {
            var e=ex as Failure;
            Console.WriteLine(Json.Serialize(new {ok=false,error=new {code=e!=null?e.Code:ex is ElementNotAvailableException?"STALE_CONTROL":"DESKTOP_ERROR",message=ex.Message}})); return 1;
        }
    }
    static object Run(string op,Dictionary<string,object>a) {
        if(op=="desktop.status") return Status();
        Require(Available(),"DESKTOP_UNAVAILABLE","Interactive desktop is locked, unavailable, or this process is in Session 0.");
        string layout=S(a,"layoutId");
        if(layout!="") Require(layout==Layout(),"DISPLAY_CHANGED","Display layout changed; observe screens again before using coordinates.");
        switch(op) {
            case "connection.approve": return ApproveConnection(a);
            case "screens": return new {coordinateSpace="virtual-desktop-physical",layoutId=Layout(),virtualBounds=Rect(SystemInformation.VirtualScreen),monitors=Screens()};
            case "screenshot": return Screenshot(a);
            case "windows.list": return Windows(a);
            case "windows.hitTest": return HitTest(a);
            case "windows.action": return WindowAction(a);
            case "app.launch": return Launch(a);
            case "ui.tree": return Tree(a);
            case "ui.find": return Find(a);
            case "ui.action": return UiAction(a);
            case "ui.wait": return Wait(a);
            case "input.mouse": return Mouse(a);
            case "input.key": return Key(a);
            case "input.text": return Text(a);
            case "input.touch": return Touch(a);
            default: throw new Failure("UNKNOWN_OPERATION",op);
        }
    }
    static void Trace(Dictionary<string,object>a,string stage) {string file=S(a,"traceFile");if(file!="")File.AppendAllText(file,Json.Serialize(new {at=DateTime.UtcNow.ToString("o"),stage=stage,apartment=Thread.CurrentThread.GetApartmentState().ToString()})+Environment.NewLine,Encoding.UTF8);}
    static bool Available() {
        if(Process.GetCurrentProcess().SessionId==0) return false;
        IntPtr desktop=OpenInputDesktop(0,false,0x0100);
        if(desktop==IntPtr.Zero) return false;
        try { return SwitchDesktop(desktop); } finally { CloseDesktop(desktop); }
    }
    static object Status() { return new {available=Available(),sessionId=Process.GetCurrentProcess().SessionId,identity=System.Security.Principal.WindowsIdentity.GetCurrent().Name,coordinateSpace="virtual-desktop-physical",layoutId=Layout()}; }
    static object ApproveConnection(Dictionary<string,object>a) {
        string decision="denied";bool remembered=false;
        DateTime deadline=DateTime.UtcNow.AddMilliseconds(Math.Max(1000,Math.Min(120000,I(a,"timeoutMs",120000))));
        Application.EnableVisualStyles();
        using(var form=new Form()) using(var timer=new System.Windows.Forms.Timer()) {
            form.Text="WDB 连接授权";form.AutoSize=true;form.AutoSizeMode=AutoSizeMode.GrowAndShrink;
            form.Font=new Font("Microsoft YaHei UI",10F);form.AutoScaleMode=AutoScaleMode.Dpi;
            form.FormBorderStyle=FormBorderStyle.FixedDialog;form.MaximizeBox=false;form.MinimizeBox=false;
            form.StartPosition=FormStartPosition.CenterScreen;form.TopMost=true;form.ShowInTaskbar=true;
            var flow=new FlowLayoutPanel{FlowDirection=FlowDirection.TopDown,WrapContents=false,AutoSize=true,AutoSizeMode=AutoSizeMode.GrowAndShrink,Padding=new Padding(20)};
            var heading=new Label{Text="允许此客户端连接？",AutoSize=true,MaximumSize=new Size(360,0),Font=new Font("Microsoft YaHei UI",11F,FontStyle.Bold)};
            var identity=new Label{Text="客户端："+S(a,"name"),AutoEllipsis=true,Size=new Size(360,26),AccessibleName="客户端："+S(a,"name")};
            var address=new Label{Text="来源："+S(a,"remoteAddress"),AutoEllipsis=true,Size=new Size(360,26),ForeColor=SystemColors.GrayText};
            var remember=new CheckBox{Text="记住此客户端",AutoSize=true,Checked=false,AccessibleName="记住此客户端"};
            var buttons=new Panel{Size=new Size(360,38)};
            var countdown=new Label{Location=new Point(0,10),Size=new Size(120,26),ForeColor=SystemColors.GrayText};
            var allow=new Button{Text="同意",Location=new Point(160,0),Size=new Size(96,36),AccessibleName="同意连接"};
            var deny=new Button{Text="拒绝",Location=new Point(264,0),Size=new Size(96,36),AccessibleName="拒绝连接",DialogResult=DialogResult.Cancel};
            Action check=delegate(){
                if(File.Exists(S(a,"cancelFile"))){decision="cancelled";form.Close();}
                else if(!Available()){decision="desktop_unavailable";form.Close();}
                else if(DateTime.UtcNow>=deadline){decision="timed_out";form.Close();}
                else countdown.Text=Math.Ceiling((deadline-DateTime.UtcNow).TotalSeconds)+" 秒后关闭";
            };
            allow.Click+=delegate {check();if(!form.IsDisposed&&form.Visible){decision="approved";remembered=remember.Checked;form.Close();}};
            deny.Click+=delegate {decision="denied";form.Close();};
            form.AcceptButton=deny;form.CancelButton=deny;
            buttons.Controls.AddRange(new Control[]{countdown,allow,deny});
            foreach(Control control in new Control[]{heading,identity,address,remember,buttons}){control.Margin=new Padding(0,0,0,8);flow.Controls.Add(control);}
            form.Controls.Add(flow);
            timer.Interval=250;timer.Tick+=delegate {check();};form.Shown+=delegate {deny.Focus();check();timer.Start();};
            form.ShowDialog();timer.Stop();
        }
        return new {decision=decision,remember=decision=="approved"&&remembered};
    }
    static object[] Screens() { return Screen.AllScreens.Select((s,i)=> {uint x=96,y=96; try {GetDpiForMonitor(MonitorFromPoint(new POINT(s.Bounds.Left+1,s.Bounds.Top+1),2),0,out x,out y);}catch{} return (object)new {index=i,name=s.DeviceName,primary=s.Primary,bounds=Rect(s.Bounds),workArea=Rect(s.WorkingArea),dpiX=x,dpiY=y};}).ToArray(); }
    static string Layout() { using(var h=SHA256.Create()) return BitConverter.ToString(h.ComputeHash(Encoding.UTF8.GetBytes(Json.Serialize(Screens())))).Replace("-","").ToLowerInvariant(); }
    static IntPtr Window(string id) {
        string[] parts=id.Split(':'); long h; int pid;
        Require(parts.Length==3 && long.TryParse(parts[0],out h) && int.TryParse(parts[1],out pid),"INVALID_WINDOW","Use the full window ID returned by windows.list.");
        IntPtr handle=new IntPtr(long.Parse(parts[0])); uint actual;
        GetWindowThreadProcessId(handle,out actual);
        Require(IsWindow(handle) && actual==int.Parse(parts[1]),"STALE_WINDOW","Window is no longer valid.");
        try { Require(Process.GetProcessById((int)actual).StartTime.ToUniversalTime().Ticks.ToString()==parts[2],"STALE_WINDOW","Window process changed."); }
        catch(ArgumentException) {throw new Failure("STALE_WINDOW","Window process exited.");}
        return handle;
    }
    static string WindowId(IntPtr h) { uint pid; GetWindowThreadProcessId(h,out pid); return h.ToInt64()+":"+pid+":"+Process.GetProcessById((int)pid).StartTime.ToUniversalTime().Ticks; }
    static object WindowInfo(IntPtr h) { uint pid; GetWindowThreadProcessId(h,out pid); var t=new StringBuilder(1024); GetWindowText(h,t,t.Capacity); RECT r; GetWindowRect(h,out r); return new {window=WindowId(h),title=t.ToString(),pid=pid,process=Process.GetProcessById((int)pid).ProcessName,bounds=Rect(r.Rectangle),minimized=IsIconic(h),maximized=IsZoomed(h),foreground=GetForegroundWindow()==h,visible=IsWindowVisible(h)}; }
    static object Windows(Dictionary<string,object>a) {
        var list=new List<object>(); EnumWindows(delegate(IntPtr h,IntPtr l) { try {if(!IsWindowVisible(h))return true; var info=WindowInfo(h);var d=D(Json.DeserializeObject(Json.Serialize(info))); if(S(a,"title")!="" && S(d,"title").IndexOf(S(a,"title"),StringComparison.OrdinalIgnoreCase)<0)return true;if(I(a,"pid")!=0 && I(d,"pid")!=I(a,"pid"))return true;if(S(a,"process")!="" && S(d,"process").IndexOf(S(a,"process"),StringComparison.OrdinalIgnoreCase)<0)return true; list.Add(info);}catch{} return true;},IntPtr.Zero);return list;
    }
    static object HitTest(Dictionary<string,object>a) {
        var point=new POINT(I(a,"x"),I(a,"y"));
        Require(Screen.AllScreens.Any(s=>s.Bounds.Contains(point.X,point.Y)),"INVALID_COORDINATE","Point is outside all monitors.");
        var child=WindowFromPoint(point);Require(child!=IntPtr.Zero,"WINDOW_NOT_FOUND","No window at point.");
        var root=GetAncestor(child,2);var className=new StringBuilder(256);GetClassName(child,className,className.Capacity);
        return new {x=point.X,y=point.Y,child=WindowInfo(child),childClass=className.ToString(),root=WindowInfo(root==IntPtr.Zero?child:root),coordinateSpace="virtual-desktop-physical",layoutId=Layout()};
    }
    static object WindowAction(Dictionary<string,object>a) {
        IntPtr h=Window(S(a,"window")); string action=S(a,"action");
        switch(action) {
            case "focus": if(IsIconic(h))ShowWindow(h,9);if(GetForegroundWindow()!=h)SetForegroundWindow(h);Thread.Sleep(50);Require(GetForegroundWindow()==h,"FOCUS_DENIED","Windows refused foreground activation; observe the current foreground window before injecting input.");break;
            case "maximize":ShowWindow(h,3);break;
            case "minimize":ShowWindow(h,6);break;
            case "restore":ShowWindow(h,9);break;
            case "move": case "resize": RECT r;GetWindowRect(h,out r); Win(MoveWindow(h,I(a,"x",r.Left),I(a,"y",r.Top),I(a,"width",r.Right-r.Left),I(a,"height",r.Bottom-r.Top),true),"MoveWindow");break;
            case "close": Win(PostMessage(h,0x10,IntPtr.Zero,IntPtr.Zero),"WM_CLOSE");break;
            case "kill": uint pid;GetWindowThreadProcessId(h,out pid);Process.GetProcessById((int)pid).Kill();break;
            default:throw new Failure("INVALID_ARGUMENT","Unknown window action.");
        }
        Thread.Sleep(150);
        return new {action=action,closed=!IsWindow(h),state=IsWindow(h)?WindowInfo(h):null,needsObservation=action=="close" && IsWindow(h)};
    }
    static object Launch(Dictionary<string,object>a) {
        string path=S(a,"path");Require(path!="","INVALID_ARGUMENT","Application path required.");
        var p=new ProcessStartInfo(path,S(a,"arguments"));p.UseShellExecute=true;if(S(a,"cwd")!="")p.WorkingDirectory=S(a,"cwd");
        var process=Process.Start(p);return new {pid=process==null?0:process.Id,path=path,sessionId=Process.GetCurrentProcess().SessionId};
    }
    static object Screenshot(Dictionary<string,object>a) {
        string path=S(a,"path");Require(path!="","INVALID_ARGUMENT","Screenshot output path required.");
        Rectangle r=SystemInformation.VirtualScreen;string method="visible-desktop";IntPtr window=IntPtr.Zero;
        if(V(a,"monitor")!=null) { int n=I(a,"monitor");Require(n>=0 && n<Screen.AllScreens.Length,"INVALID_ARGUMENT","Monitor index out of range.");r=Screen.AllScreens[n].Bounds; }
        if(S(a,"window")!="") {window=Window(S(a,"window"));RECT wr;GetWindowRect(window,out wr);r=wr.Rectangle;}
        if(V(a,"region")!=null) {var q=D(a["region"]);r=new Rectangle(I(q,"x"),I(q,"y"),I(q,"width"),I(q,"height"));}
        Require(r.Width>0 && r.Height>0 && (long)r.Width*r.Height<=100000000,"INVALID_ARGUMENT","Invalid screenshot dimensions.");
        string initialLayout=Layout();Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path)));
        using(var bmp=new Bitmap(r.Width,r.Height,PixelFormat.Format32bppArgb)) {
            using(var g=Graphics.FromImage(bmp)) {
                if(window!=IntPtr.Zero && V(a,"region")==null) {var dc=g.GetHdc();bool printed;try{printed=PrintWindow(window,dc,2);}finally{g.ReleaseHdc(dc);}Require(printed,"CAPTURE_FAILED","Window capture failed; use a visible region screenshot.");method="PrintWindow";}
                else {Require(SystemInformation.VirtualScreen.Contains(r),"INVALID_ARGUMENT","Screenshot region is outside virtual desktop.");g.CopyFromScreen(r.Location,Point.Empty,r.Size,CopyPixelOperation.SourceCopy);}
            }
            Require(initialLayout==Layout(),"DISPLAY_CHANGED","Display changed during capture; retry observation.");bmp.Save(path,ImageFormat.Png);
        }
        return new {path=Path.GetFullPath(path),format="png",width=r.Width,height=r.Height,bounds=Rect(r),coordinateSpace="virtual-desktop-physical",layoutId=initialLayout,mapping=new {scaleX=1,scaleY=1,offsetX=r.X,offsetY=r.Y},method=method,bytes=new FileInfo(path).Length};
    }
    static AutomationElement Root(Dictionary<string,object>a) {return AutomationElement.FromHandle(Window(S(a,"window")));}
    static object Control(AutomationElement e,string window,int depth) { var c=e.Current;object toggle;string toggleState=e.TryGetCurrentPattern(TogglePattern.Pattern,out toggle)?((TogglePattern)toggle).Current.ToggleState.ToString():null;return new {reference=new {window=window,runtimeId=e.GetRuntimeId(),locator=new {name=c.Name,automationId=c.AutomationId,controlType=c.ControlType.ProgrammaticName.Replace("ControlType.","")}},name=c.Name,automationId=c.AutomationId,controlType=c.ControlType.ProgrammaticName.Replace("ControlType.",""),className=c.ClassName,enabled=c.IsEnabled,offscreen=c.IsOffscreen,bounds=Rect(c.BoundingRectangle),actions=e.GetSupportedPatterns().Select(p=>p.ProgrammaticName.Replace("PatternIdentifiers.Pattern","")).ToArray(),toggleState=toggleState,depth=depth}; }
    static List<object> Traverse(AutomationElement root,string window,int max,int depth) {
        var result=new List<object>();var queue=new Queue<Tuple<AutomationElement,int>>();queue.Enqueue(Tuple.Create(root,0));
        while(queue.Count>0 && result.Count<max){var item=queue.Dequeue();try{result.Add(Control(item.Item1,window,item.Item2));if(item.Item2<depth){var child=TreeWalker.ControlViewWalker.GetFirstChild(item.Item1);while(child!=null){queue.Enqueue(Tuple.Create(child,item.Item2+1));child=TreeWalker.ControlViewWalker.GetNextSibling(child);}}}catch(ElementNotAvailableException){}}
        return result;
    }
    static object Tree(Dictionary<string,object>a) {int limit=Math.Max(1,Math.Min(I(a,"limit",500),5000));var controls=Traverse(Root(a),S(a,"window"),limit,Math.Min(I(a,"depth",12),30));return new {controls=controls,truncated=controls.Count==limit,coordinateSpace="virtual-desktop-physical",layoutId=Layout()};}
    static Condition Query(Dictionary<string,object>a) {
        var c=new List<Condition>();if(V(a,"name")!=null)c.Add(new PropertyCondition(AutomationElement.NameProperty,S(a,"name")));if(V(a,"automationId")!=null)c.Add(new PropertyCondition(AutomationElement.AutomationIdProperty,S(a,"automationId")));if(V(a,"enabled")!=null)c.Add(new PropertyCondition(AutomationElement.IsEnabledProperty,B(a,"enabled")));
        if(S(a,"controlType")!=""){var f=typeof(ControlType).GetField(S(a,"controlType"));Require(f!=null,"INVALID_ARGUMENT","Unknown controlType.");c.Add(new PropertyCondition(AutomationElement.ControlTypeProperty,f.GetValue(null)));}
        Require(c.Count>0,"INVALID_ARGUMENT","At least one exact control property is required.");return c.Count==1?c[0]:new AndCondition(c.ToArray());
    }
    static object Find(Dictionary<string,object>a) {var elements=Root(a).FindAll(TreeScope.Subtree,Query(a));var found=new List<object>();int limit=Math.Min(I(a,"limit",100),5000);for(int i=0;i<elements.Count && i<limit;i++)found.Add(Control(elements[i],S(a,"window"),-1));return new {controls=found,count=elements.Count,truncated=elements.Count>limit};}
    static AutomationElement Resolve(Dictionary<string,object>a) {
        Cancelled(a);Require(V(a,"reference")!=null,"INVALID_ARGUMENT","Control reference required.");var reference=D(a["reference"]);string win=S(reference,"window");var ids=A(reference["runtimeId"]).Select(Convert.ToInt32).ToArray();var root=AutomationElement.FromHandle(Window(win));
        Condition condition=V(reference,"locator")!=null?Query(D(reference["locator"])):new PropertyCondition(AutomationElement.RuntimeIdProperty,ids);
        var all=root.FindAll(TreeScope.Subtree,condition);Cancelled(a);
        for(int i=0;i<all.Count;i++){try{if(all[i].GetRuntimeId().SequenceEqual(ids))return all[i];}catch(ElementNotAvailableException){}}
        throw new Failure("STALE_CONTROL","Control reference is stale; query the window again.");
    }
    static object UiAction(Dictionary<string,object>a) {
        Trace(a,"resolve.begin");var e=Resolve(a);Trace(a,"resolve.completed");Cancelled(a);string action=S(a,"action");string method=S(a,"method","uia");
        if(method=="input") {Require(action=="click","INVALID_ARGUMENT","Input method supports click; use input.key/text for keyboard events.");var r=e.Current.BoundingRectangle;Require(!r.IsEmpty && !e.Current.IsOffscreen,"CONTROL_UNAVAILABLE","Control is offscreen.");WindowAction(new Dictionary<string,object>{{"window",S(D(a["reference"]),"window")},{"action","focus"}});Mouse(new Dictionary<string,object>{{"x",(int)(r.X+r.Width/2)},{"y",(int)(r.Y+r.Height/2)},{"action","click"}});return new {method="SendInput",action=action};}
        Require(method=="uia","INVALID_ARGUMENT","method must be uia or input.");object pattern;
        switch(action) {
            case "invoke": Trace(a,"pattern.begin");pattern=ActionPattern(e,InvokePattern.Pattern,a);Trace(a,"invoke.begin");((InvokePattern)pattern).Invoke();Trace(a,"invoke.completed");break;
            case "value":pattern=ActionPattern(e,ValuePattern.Pattern,a);((ValuePattern)pattern).SetValue(S(a,"value"));break;
            case "toggle":pattern=ActionPattern(e,TogglePattern.Pattern,a);((TogglePattern)pattern).Toggle();break;
            case "select":pattern=ActionPattern(e,SelectionItemPattern.Pattern,a);((SelectionItemPattern)pattern).Select();break;
            case "expand":case "collapse":pattern=ActionPattern(e,ExpandCollapsePattern.Pattern,a);if(action=="expand")((ExpandCollapsePattern)pattern).Expand();else ((ExpandCollapsePattern)pattern).Collapse();break;
            case "focus":e.SetFocus();break;
            default:throw new Failure("INVALID_ARGUMENT","Unknown UIA action.");
        }
        Trace(a,"observe.begin");object observed=null;try{observed=Control(e,S(D(a["reference"]),"window"),-1);}catch(ElementNotAvailableException){}Trace(a,"observe.completed");
        return new {method="uia",action=action,observed=observed};
    }
    static object ActionPattern(AutomationElement element,AutomationPattern kind,Dictionary<string,object>a) {object pattern;Require(element.TryGetCurrentPattern(kind,out pattern),"PATTERN_UNAVAILABLE",kind.ProgrammaticName+" unavailable.");Cancelled(a);return pattern;}
    static object Wait(Dictionary<string,object>a) {int timeout=Math.Max(0,Math.Min(I(a,"timeoutMs",10000),300000));string state=S(a,"state","appeared");Require(state=="appeared"||state=="disappeared"||state=="enabled"||state=="disabled","INVALID_ARGUMENT","Invalid wait state.");var timer=Stopwatch.StartNew();while(true){Cancelled(a);var found=Root(a).FindAll(TreeScope.Subtree,Query(a));bool ok=state=="disappeared"?found.Count==0:found.Count>0;if(ok&&(state=="enabled"||state=="disabled"))ok=found.Cast<AutomationElement>().All(e=>e.Current.IsEnabled==(state=="enabled"));if(ok)return new {state=state,elapsedMs=timer.ElapsedMilliseconds,count=found.Count};if(timer.ElapsedMilliseconds>=timeout)throw new Failure("TIMEOUT","Control wait timed out; operation was not retried.");Thread.Sleep(100);}}
    static void Cancelled(Dictionary<string,object>a) {if(S(a,"cancelFile")!="" && File.Exists(S(a,"cancelFile")))throw new Failure("CANCELLED","Input task was cancelled; held input released.");}
    static void Delay(int ms,Dictionary<string,object>a){var w=Stopwatch.StartNew();while(w.ElapsedMilliseconds<ms){Cancelled(a);Thread.Sleep((int)Math.Min(10,ms-w.ElapsedMilliseconds));}}
    static INPUT MouseInput(uint flags,int data=0){var input=new INPUT();input.type=0;input.u.mi.dwFlags=flags;input.u.mi.mouseData=(uint)data;return input;}
    static void Send(params INPUT[] input){Require(SendInput((uint)input.Length,input,Marshal.SizeOf(typeof(INPUT)))==input.Length,"INPUT_REJECTED","SendInput rejected input (possibly integrity/UAC boundary).");}
    static void Position(int x,int y){Require(Screen.AllScreens.Any(s=>s.Bounds.Contains(x,y)),"INVALID_COORDINATE","Point is outside all monitors.");Win(SetCursorPos(x,y),"SetCursorPos");}
    static object Mouse(Dictionary<string,object>a){string action=S(a,"action","click");if(V(a,"x")!=null)Position(I(a,"x"),I(a,"y"));string button=S(a,"button","left");Require(button=="left"||button=="right"||button=="middle","INVALID_ARGUMENT","Invalid mouse button.");uint down=button=="right"?8u:button=="middle"?32u:2u;uint up=down*2;switch(action){case "move":break;case "click":Send(MouseInput(down),MouseInput(up));break;case "doubleClick":Send(MouseInput(down),MouseInput(up));Thread.Sleep(80);Send(MouseInput(down),MouseInput(up));break;case "scroll":Send(MouseInput(B(a,"horizontal")?0x1000u:0x800u,I(a,"delta",120)));break;case "drag":int x=I(a,"x"),y=I(a,"y"),toX=I(a,"toX"),toY=I(a,"toY"),duration=Math.Max(1,I(a,"durationMs",500));Require(Screen.AllScreens.Any(s=>s.Bounds.Contains(toX,toY)),"INVALID_COORDINATE","Drag endpoint outside monitors.");Send(MouseInput(down));try{var watch=Stopwatch.StartNew();while(watch.ElapsedMilliseconds<duration){Cancelled(a);double fraction=(double)watch.ElapsedMilliseconds/duration;Position(x+(int)((toX-x)*fraction),y+(int)((toY-y)*fraction));Thread.Sleep(8);}Position(toX,toY);}finally{Send(MouseInput(up));}break;default:throw new Failure("INVALID_ARGUMENT","Unknown mouse action.");}return new {method="SendInput",action=action,position=new {x=Cursor.Position.X,y=Cursor.Position.Y}};}
    static ushort KeyCode(string key){var alias=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase){{"ctrl","ControlKey"},{"control","ControlKey"},{"alt","Menu"},{"shift","ShiftKey"},{"win","LWin"},{"esc","Escape"},{"return","Enter"}};if(alias.ContainsKey(key))key=alias[key];Keys parsed;Require(Enum.TryParse<Keys>(key,true,out parsed),"INVALID_ARGUMENT","Unknown key "+key);return (ushort)parsed;}
    static INPUT KeyInput(ushort key,bool up,bool unicode=false){var input=new INPUT();input.type=1;input.u.ki.wVk=unicode?(ushort)0:key;input.u.ki.wScan=unicode?key:(ushort)0;input.u.ki.dwFlags=(up?2u:0u)|(unicode?4u:0u);return input;}
    static object Key(Dictionary<string,object>a){string action=S(a,"action","press");var keys=V(a,"keys")!=null?A(a["keys"]).Select(Convert.ToString).ToArray():S(a,"key").Split('+');Require(keys.Length>0&&keys.Length<=16,"INVALID_ARGUMENT","Expected key or keys.");var codes=keys.Select(KeyCode).ToArray();if(action=="up"){foreach(var k in codes.Reverse())Send(KeyInput(k,true));return new {method="SendInput",released=true};}Require(action=="press"||action=="down","INVALID_ARGUMENT","Invalid key action.");int hold=I(a,"holdMs",action=="down"?1000:30);Require(hold>=0&&hold<=300000,"INVALID_ARGUMENT","holdMs must be within 0..300000; down is bounded and releases on completion.");var pressed=new List<ushort>();try{foreach(var k in codes){Send(KeyInput(k,false));pressed.Add(k);}Delay(hold,a);}finally{foreach(var k in pressed.AsEnumerable().Reverse())Send(KeyInput(k,true));}return new {method="SendInput",keys=keys,holdMs=hold,released=true};}
    static object Text(Dictionary<string,object>a){string text=S(a,"text"),method=S(a,"method","unicode");if(method=="uia"){a["action"]="value";a["value"]=text;UiAction(a);return new {method="uia",characters=text.Length};}Require(method=="unicode","INVALID_ARGUMENT","Text method must be unicode or uia.");foreach(char ch in text){Cancelled(a);Send(KeyInput(ch,false,true),KeyInput(ch,true,true));}return new {method="unicode",characters=text.Length};}
    sealed class Contact {public int id,x,y,nativeId;public string phase;}
    sealed class Frame {public double time;public List<Contact> contacts;}
    static object Touch(Dictionary<string,object>a){
        Require(V(a,"frames")!=null,"INVALID_TRAJECTORY","frames array required.");var frames=new List<Frame>();var validate=new Dictionary<int,Contact>();double last=-1;int samples=0,maxContacts=0;
        foreach(var raw in A(a["frames"])) {var f=D(raw);double t=Convert.ToDouble(V(f,"t",-1));Require(t>=0&&t>=last&&t<=3600000,"INVALID_TRAJECTORY","Frame time must be monotonic milliseconds within one hour.");last=t;var contacts=new List<Contact>();var seen=new HashSet<int>();var frameSlots=new HashSet<int>(validate.Values.Select(v=>v.nativeId));foreach(var rc in A(f["contacts"])) {var c=D(rc);var p=new Contact{id=I(c,"id"),x=I(c,"x"),y=I(c,"y"),phase=S(c,"phase")};Require(p.id>=1&&p.id<=65535&&seen.Add(p.id),"INVALID_TRAJECTORY","Contact IDs must be unique positive values within each frame.");Require(Screen.AllScreens.Any(s=>s.Bounds.Contains(p.x,p.y)),"INVALID_COORDINATE","Touch point outside monitors.");if(p.phase=="down"){Require(!validate.ContainsKey(p.id),"INVALID_TRAJECTORY","Contact already down.");Require(validate.Count<10 && frameSlots.Count<10,"INVALID_TRAJECTORY","Maximum 10 simultaneous contacts; when all slots are occupied, put up and new down transitions in separate frames.");p.nativeId=Enumerable.Range(0,10).First(n=>!frameSlots.Contains(n));frameSlots.Add(p.nativeId);validate[p.id]=p;}else{Require((p.phase=="move"||p.phase=="up")&&validate.ContainsKey(p.id),"INVALID_TRAJECTORY","Move/up requires an active contact.");p.nativeId=validate[p.id].nativeId;if(p.phase=="up"){Require(validate[p.id].x==p.x&&validate[p.id].y==p.y,"INVALID_TRAJECTORY","Up must use last move coordinates (Windows touch contract).");validate.Remove(p.id);}else validate[p.id]=p;}contacts.Add(p);samples++;}maxContacts=Math.Max(maxContacts,validate.Count);Require(maxContacts<=10,"INVALID_TRAJECTORY","Maximum 10 simultaneous contacts.");frames.Add(new Frame{time=t,contacts=contacts});}
        Require(frames.Count>0&&validate.Count==0,"INVALID_TRAJECTORY","Trajectory must be nonempty and release every contact.");
        IntPtr device=CreateSyntheticPointerDevice(2,10,3);Win(device!=IntPtr.Zero,"CreateSyntheticPointerDevice");var active=new Dictionary<int,Contact>();var watch=Stopwatch.StartNew();int executed=0,retries=0;double maxLateness=0;string layout=Layout();
        try {foreach(var frame in frames){while(watch.Elapsed.TotalMilliseconds<frame.time){Cancelled(a);Thread.Sleep(1);}Cancelled(a);Require(Layout()==layout,"DISPLAY_CHANGED","Display changed during touch.");var states=active.ToDictionary(x=>x.Key,x=>new Contact{id=x.Key,x=x.Value.x,y=x.Value.y,nativeId=x.Value.nativeId,phase="move"});foreach(var c in frame.contacts)states[c.id]=c;var inputs=states.Values.Select(c=>TouchInfo(c,false)).ToArray();if(inputs.Length>0){for(int attempt=0;;attempt++){if(InjectSyntheticPointerInput(device,inputs.Select(p=>new POINTER_TYPE_INFO{type=2,touchInfo=p}).ToArray(),(uint)inputs.Length))break;int error=Marshal.GetLastWin32Error();if(error==21 && attempt<20){retries++;Thread.Sleep(1);continue;}throw new Failure("TOUCH_INJECTION_FAILED","InjectSyntheticPointerInput error "+error+" after "+executed+" frames; no sample was silently dropped.");}}foreach(var c in frame.contacts){if(c.phase=="up")active.Remove(c.id);else active[c.id]=c;}executed++;maxLateness=Math.Max(maxLateness,watch.Elapsed.TotalMilliseconds-frame.time);}}
        finally{if(active.Count>0){var releases=active.Values.Select(c=>TouchInfo(c,true)).ToArray();for(int retry=0;retry<20;retry++){if(InjectSyntheticPointerInput(device,releases.Select(p=>new POINTER_TYPE_INFO{type=2,touchInfo=p}).ToArray(),(uint)releases.Length))break;Thread.Sleep(1);}}Thread.Sleep(200);DestroySyntheticPointerDevice(device);}
        // Device teardown follows a delivery drain in finally.
        return new {method="InjectSyntheticPointerInput",frames=executed,samples=samples,maxContacts=maxContacts,elapsedMs=watch.Elapsed.TotalMilliseconds,maxLatenessMs=maxLateness,notReadyRetries=retries,businessOutcome="not-evaluated",released=true};
    }
    static POINTER_TOUCH_INFO TouchInfo(Contact c,bool cancel){var p=new POINTER_TOUCH_INFO();p.pointerInfo.pointerType=2;p.pointerInfo.pointerId=(uint)c.nativeId;p.pointerInfo.pointerFlags=cancel?0x48000u:c.phase=="down"?0x10006u:c.phase=="up"?0x40000u:0x20006u;p.pointerInfo.ptPixelLocation=new POINT(c.x,c.y);p.touchMask=7;p.rcContact=new RECT{Left=c.x-2,Top=c.y-2,Right=c.x+2,Bottom=c.y+2};p.orientation=90;p.pressure=512;return p;}
    [StructLayout(LayoutKind.Sequential)] struct POINT {public int X,Y;public POINT(int x,int y){X=x;Y=y;}}
    [StructLayout(LayoutKind.Sequential)] struct RECT {public int Left,Top,Right,Bottom;public Rectangle Rectangle {get{return Rectangle.FromLTRB(Left,Top,Right,Bottom);}}}
    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT {public int dx,dy;public uint mouseData,dwFlags,time;public UIntPtr dwExtraInfo;}
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT {public ushort wVk,wScan;public uint dwFlags,time;public UIntPtr dwExtraInfo;}
    [StructLayout(LayoutKind.Explicit)] struct INPUTUNION {[FieldOffset(0)]public MOUSEINPUT mi;[FieldOffset(0)]public KEYBDINPUT ki;}
    [StructLayout(LayoutKind.Sequential)] struct INPUT {public uint type;public INPUTUNION u;}
    [StructLayout(LayoutKind.Sequential)] struct POINTER_INFO {public uint pointerType,pointerId,frameId,pointerFlags;public IntPtr sourceDevice,hwndTarget;public POINT ptPixelLocation,ptHimetricLocation,ptPixelLocationRaw,ptHimetricLocationRaw;public uint dwTime,historyCount;public int InputData;public uint dwKeyStates;public ulong PerformanceCount;public uint ButtonChangeType;}
    [StructLayout(LayoutKind.Sequential)] struct POINTER_TOUCH_INFO {public POINTER_INFO pointerInfo;public uint touchFlags,touchMask;public RECT rcContact,rcContactRaw;public uint orientation,pressure;}
    [StructLayout(LayoutKind.Explicit,Size=152)] struct POINTER_TYPE_INFO {[FieldOffset(0)]public uint type;[FieldOffset(8)]public POINTER_TOUCH_INFO touchInfo;}
    [DllImport("user32.dll",SetLastError=true)]static extern IntPtr CreateSyntheticPointerDevice(uint type,uint count,uint mode);
    [DllImport("user32.dll",SetLastError=true)]static extern bool InjectSyntheticPointerInput(IntPtr device,POINTER_TYPE_INFO[] info,uint count);
    [DllImport("user32.dll")]static extern void DestroySyntheticPointerDevice(IntPtr device);
    delegate bool EnumWindowsProc(IntPtr hwnd,IntPtr lparam);
    [DllImport("user32.dll")]static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")]static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")]static extern IntPtr OpenInputDesktop(uint flags,bool inherit,uint access);
    [DllImport("user32.dll")]static extern bool CloseDesktop(IntPtr desktop);
    [DllImport("user32.dll")]static extern bool SwitchDesktop(IntPtr desktop);
    [DllImport("user32.dll")]static extern bool EnumWindows(EnumWindowsProc callback,IntPtr param);
    [DllImport("user32.dll")]static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")]static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")]static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")]static extern bool IsZoomed(IntPtr h);
    [DllImport("user32.dll")]static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]static extern IntPtr WindowFromPoint(POINT point);
    [DllImport("user32.dll")]static extern IntPtr GetAncestor(IntPtr h,uint flags);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetClassName(IntPtr h,StringBuilder text,int count);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetWindowText(IntPtr h,StringBuilder text,int count);
    [DllImport("user32.dll")]static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
    [DllImport("user32.dll")]static extern bool GetWindowRect(IntPtr h,out RECT rect);
    [DllImport("user32.dll")]static extern bool ShowWindow(IntPtr h,int command);
    [DllImport("user32.dll",SetLastError=true)]static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll",SetLastError=true)]static extern bool MoveWindow(IntPtr h,int x,int y,int width,int height,bool repaint);
    [DllImport("user32.dll",SetLastError=true)]static extern bool PostMessage(IntPtr h,uint msg,IntPtr w,IntPtr l);
    [DllImport("user32.dll")]static extern bool PrintWindow(IntPtr h,IntPtr dc,uint flags);
    [DllImport("user32.dll")]static extern IntPtr MonitorFromPoint(POINT p,uint flags);
    [DllImport("shcore.dll")]static extern int GetDpiForMonitor(IntPtr h,int type,out uint x,out uint y);
    [DllImport("user32.dll",SetLastError=true)]static extern bool SetCursorPos(int x,int y);
    [DllImport("user32.dll",SetLastError=true)]static extern uint SendInput(uint count,INPUT[] inputs,int size);
    [DllImport("user32.dll",SetLastError=true)]static extern bool InitializeTouchInjection(uint count,uint mode);
    [DllImport("user32.dll",SetLastError=true)]static extern bool InjectTouchInput(uint count,POINTER_TOUCH_INFO[] contacts);
}









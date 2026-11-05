using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public class DesktopFixture : Form {
    static readonly bool RawTouch=Environment.GetEnvironmentVariable("WDB_FIXTURE_RAW_TOUCH")=="1";
    string log; Label status; InkPanel ink;
    public DesktopFixture(string logPath) {
        TopMost=true;Shown+=(sender,eventArgs)=>{BringToFront();Activate();};log=logPath;Text="wdb desktop verification fixture";Name="WdbFixture";StartPosition=FormStartPosition.Manual;Location=new Point(80,80);ClientSize=new Size(720,540);
        var input=new TextBox{ Name="Input",AccessibleName="wdb input",Multiline=false,Location=new Point(16,16),Size=new Size(440,60)};
        status=new Label{Name="Status",AccessibleName="wdb status",Text="Clicks: 0",Location=new Point(16,84),Size=new Size(400,24)};
        var button=new Button{Name="Apply",AccessibleName="wdb apply",Text="Apply",Location=new Point(480,16),Size=new Size(120,40)};
        int clicks=0;button.Click+=(s,e)=>{status.Text="Clicks: "+(++clicks);File.AppendAllText(log,"CLICK "+clicks+" TEXT "+input.Text.Replace("\r","\\r").Replace("\n","\\n")+Environment.NewLine);};
        ink=new InkPanel(log){Name="Ink",AccessibleName="wdb touch canvas",Location=new Point(16,120),Size=new Size(680,390),BackColor=Color.White};
        Controls.Add(input);Controls.Add(button);Controls.Add(status);Controls.Add(ink);
        FormClosed+=(s,e)=>{ink.Save(log+".png");};
    }
    protected override void OnHandleCreated(EventArgs e){base.OnHandleCreated(e);RegisterTouchWindow(Handle,3);ConfigureGestures(Handle);}
    protected override void WndProc(ref Message m){if(RawTouch && m.Msg==0x2cc){m.Result=new IntPtr(0x01190019);return;}if(ink!=null && (m.Msg==0x240 || (m.Msg>=0x245 && m.Msg<=0x247))){ink.Route(ref m);return;}base.WndProc(ref m);}
    [DllImport("user32.dll")]static extern bool RegisterTouchWindow(IntPtr hwnd,uint flags);
    [StructLayout(LayoutKind.Sequential)] struct GESTURECONFIG {public uint dwID,dwWant,dwBlock;}
    [DllImport("user32.dll",SetLastError=true)] static extern bool SetGestureConfig(IntPtr hwnd,uint reserved,uint count,GESTURECONFIG[] configs,uint size);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern bool SetProp(IntPtr hwnd,string name,IntPtr value);
    static void ConfigureGestures(IntPtr h){if(!RawTouch)return;SetGestureConfig(h,0,1,new[]{new GESTURECONFIG{dwID=0,dwWant=0,dwBlock=1}},12);SetProp(h,"MicrosoftTabletPenServiceProperty",new IntPtr(0x01190019));}
    [STAThread] public static void Main(string[] args){Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);Application.Run(new DesktopFixture(args[0]));}
    class InkPanel:Panel {
        string log; Bitmap image;Dictionary<uint,Point> last=new Dictionary<uint,Point>();
        public InkPanel(string path){log=path;DoubleBuffered=true;image=new Bitmap(680,390);using(var g=Graphics.FromImage(image))g.Clear(Color.White);}
        protected override void OnHandleCreated(EventArgs e){base.OnHandleCreated(e);ConfigureGestures(Handle);File.AppendAllText(log,"REGISTER "+RegisterTouchWindow(Handle,3)+Environment.NewLine);}
        protected override void OnPaint(PaintEventArgs e){base.OnPaint(e);e.Graphics.DrawImageUnscaled(image,0,0);}
        public void Save(string path){image.Save(path,System.Drawing.Imaging.ImageFormat.Png);}
        public void Route(ref Message m){WndProc(ref m);}
        protected override void WndProc(ref Message m){if(RawTouch && m.Msg==0x2cc){m.Result=new IntPtr(0x01190019);return;}if(m.Msg>=0x245 && m.Msg<=0x247){uint id=(uint)(m.WParam.ToInt64()&0xffff);uint type;GetPointerType(id,out type);if(type==2){var point=PointToClient(new Point((short)(m.LParam.ToInt64()&0xffff),(short)((m.LParam.ToInt64()>>16)&0xffff)));string phase=m.Msg==0x246?"down":m.Msg==0x247?"up":"move";File.AppendAllText(log,"POINTER_TOUCH "+id+" "+phase+" "+point.X+" "+point.Y+Environment.NewLine);}}if(m.Msg==0x240){int count=(int)m.WParam.ToInt64()&0xffff;var inputs=new TOUCHINPUT[count];try{if(GetTouchInputInfo(m.LParam,count,inputs,Marshal.SizeOf(typeof(TOUCHINPUT)))){foreach(var p in inputs){var point=PointToClient(new Point(p.x/100,p.y/100));string phase=(p.dwFlags&2)!=0?"down":(p.dwFlags&4)!=0?"up":"move";File.AppendAllText(log,"TOUCH "+p.dwID+" "+phase+" "+point.X+" "+point.Y+Environment.NewLine);using(var g=Graphics.FromImage(image)){using(var pen=new Pen(Color.FromArgb(255,(int)(p.dwID*71)%220,(int)(p.dwID*113)%220,(int)(p.dwID*31)%220),2)){if(last.ContainsKey(p.dwID))g.DrawLine(pen,last[p.dwID],point);else g.DrawEllipse(pen,point.X-1,point.Y-1,2,2);}}if(phase=="up")last.Remove(p.dwID);else last[p.dwID]=point;}Invalidate();}}finally{CloseTouchInputHandle(m.LParam);}m.Result=IntPtr.Zero;return;}base.WndProc(ref m);}
        [StructLayout(LayoutKind.Sequential)]struct TOUCHINPUT{public int x,y;public IntPtr hSource;public uint dwID,dwFlags,dwMask,dwTime;public UIntPtr dwExtraInfo;public uint cxContact,cyContact;}
        [DllImport("user32.dll")]static extern bool GetPointerType(uint id,out uint type);
        [DllImport("user32.dll")]static extern bool RegisterTouchWindow(IntPtr hwnd,uint flags);
        [DllImport("user32.dll")]static extern bool GetTouchInputInfo(IntPtr handle,int count,[Out]TOUCHINPUT[] inputs,int size);
        [DllImport("user32.dll")]static extern bool CloseTouchInputHandle(IntPtr handle);
    }
}








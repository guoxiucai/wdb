using System;using System.Drawing;using System.Windows.Forms;
internal sealed class RecordingFixture:Form {
 int frame;Timer timer=new Timer();
 RecordingFixture(){Text="WDB recording validation fixture";FormBorderStyle=FormBorderStyle.None;Bounds=Screen.AllScreens[0].Bounds;TopMost=true;DoubleBuffered=true;BackColor=Color.DarkBlue;timer.Interval=33;timer.Tick+=delegate{frame++;Invalidate();};if(Environment.GetEnvironmentVariable("WDB_STATIC_FIXTURE")!="1")timer.Start();}
 protected override void OnPaint(PaintEventArgs e){base.OnPaint(e);e.Graphics.FillRectangle(Brushes.Lime,(frame*15)%Math.Max(1,Width-160),Height/2,160,160);e.Graphics.DrawString("WDB TEST ONLY   Frame "+frame,new Font("Consolas",36),Brushes.White,30,40);}
 [STAThread]static void Main(){Application.Run(new RecordingFixture());}
}

using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using N=MediaNative;

// A bounded staging path also works when the selected MF encoder cannot import
// DXGI surfaces. No raw frames cross the Node IPC boundary.
internal sealed class VideoProcessor:IDisposable {
 IntPtr device,context,videoDevice,videoContext,enumerator,processor,input,output,staging,inputView,outputView;
 [StructLayout(LayoutKind.Sequential)] struct Content {public int format,inNum,inDen,inWidth,inHeight,outNum,outDen,outWidth,outHeight,usage;}
 [StructLayout(LayoutKind.Sequential)] struct View {public int a,b,c,d;}
 [StructLayout(LayoutKind.Sequential)] struct Stream {public int enable,index,frame,past,future;public IntPtr pastSurfaces,input,futureSurfaces,pastRight,inputRight,futureRight;}
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int CreateEnum(IntPtr p,ref Content content,out IntPtr result);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int CreateProcessor(IntPtr p,IntPtr e,int index,out IntPtr result);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int CreateView(IntPtr p,IntPtr resource,IntPtr e,ref View desc,out IntPtr result);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate void SetRect(IntPtr p,IntPtr processor,int stream,int enable,ref N.Rect rect);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate void SetColor(IntPtr p,IntPtr processor,int stream,ref int color);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int Blt(IntPtr p,IntPtr processor,IntPtr output,int frame,int count,ref Stream stream);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate void Update(IntPtr p,IntPtr resource,int index,IntPtr box,IntPtr data,int pitch,int depth);
 internal VideoProcessor(IntPtr d,IntPtr c,int width,int height){device=d;context=c;string stage="interfaces";try{
  videoDevice=N.Query(d,"10ec4d5b-975a-4689-b9e4-d0aac30fe333");videoContext=N.Query(c,"61f21c45-3c0e-4a74-9cea-67100d9ad5e4");
  stage="enumerator";var content=new Content{inNum=30,inDen=1,inWidth=width,inHeight=height,outNum=30,outDen=1,outWidth=1920,outHeight=1080};
  N.Check(N.Method<CreateEnum>(videoDevice,10)(videoDevice,ref content,out enumerator));stage="processor";N.Check(N.Method<CreateProcessor>(videoDevice,4)(videoDevice,enumerator,0,out processor));
  stage="input texture";var desc=new N.TextureDesc{width=width,height=height,mips=1,array=1,format=87,samples=1,bind=32};N.Check(N.Method<N.CreateTexture>(device,5)(device,ref desc,IntPtr.Zero,out input));
  stage="output texture";desc.width=1920;desc.height=1080;desc.format=103;desc.bind=32;N.Check(N.Method<N.CreateTexture>(device,5)(device,ref desc,IntPtr.Zero,out output));stage="staging texture";desc.usage=3;desc.bind=0;desc.cpu=0x20000;N.Check(N.Method<N.CreateTexture>(device,5)(device,ref desc,IntPtr.Zero,out staging));
  stage="input view";var iv=new View{b=1};N.Check(N.Method<CreateView>(videoDevice,8)(videoDevice,input,enumerator,ref iv,out inputView));stage="output view";var ov=new View{a=1};N.Check(N.Method<CreateView>(videoDevice,9)(videoDevice,output,enumerator,ref ov,out outputView));
  double scale=Math.Min(1920.0/width,1080.0/height);int w=(int)(width*scale),h=(int)(height*scale);var rect=new N.Rect{left=(1920-w)/2,top=(1080-h)/2,right=(1920+w)/2,bottom=(1080+h)/2};N.Method<SetRect>(videoContext,31)(videoContext,processor,0,1,ref rect);
  // RGB full range input; limited-range BT.601 output matches software path.
  int color=0;N.Method<SetColor>(videoContext,28)(videoContext,processor,0,ref color);
 }catch(Exception e){Dispose();throw new Exception(stage+": "+e.Message,e);}}
 internal byte[] Convert(Bitmap bitmap){var bits=bitmap.LockBits(new Rectangle(0,0,bitmap.Width,bitmap.Height),ImageLockMode.ReadOnly,PixelFormat.Format32bppArgb);try{N.Method<Update>(context,48)(context,input,0,IntPtr.Zero,bits.Scan0,bits.Stride,0);}finally{bitmap.UnlockBits(bits);}
  var stream=new Stream{enable=1,input=inputView};N.Check(N.Method<Blt>(videoContext,53)(videoContext,processor,outputView,0,1,ref stream));N.Method<N.CopyResource>(context,47)(context,staging,output);N.Mapped mapped;N.Check(N.Method<N.Map>(context,14)(context,staging,0,1,0,out mapped));try{var bytes=new byte[1920*1080*3/2];for(int y=0;y<1620;y++)Marshal.Copy(IntPtr.Add(mapped.data,y*mapped.rowPitch),bytes,y*1920,1920);return bytes;}finally{N.Method<N.Unmap>(context,15)(context,staging,0);}}
 public void Dispose(){N.Release(ref inputView);N.Release(ref outputView);N.Release(ref staging);N.Release(ref output);N.Release(ref input);N.Release(ref processor);N.Release(ref enumerator);N.Release(ref videoContext);N.Release(ref videoDevice);}
}

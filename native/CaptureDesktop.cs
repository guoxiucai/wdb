using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using N=MediaNative;

internal sealed class DesktopCapture:IDisposable {
 [StructLayout(LayoutKind.Sequential)] struct PointerShape {public int type,width,height,pitch,hotX,hotY;}
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int GetPointer(IntPtr p,int size,IntPtr bytes,out int required,out PointerShape shape);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int GetDesc1(IntPtr p,IntPtr desc);
 byte[] pointer;PointerShape pointerShape;int pointerX,pointerY;bool pointerVisible;
 static void CheckSdr(IntPtr output){IntPtr advanced=IntPtr.Zero,desc=IntPtr.Zero;try{try{advanced=N.Query(output,"068346e8-aaec-4b84-add7-137f513f77a1");}catch(COMException){return;}desc=Marshal.AllocHGlobal(256);N.Check(N.Method<GetDesc1>(advanced,27)(advanced,desc));int colorSpace=Marshal.ReadInt32(desc,100);if(colorSpace!=0)throw new Exception("HDR_OR_COLORSPACE_UNSUPPORTED");}finally{if(desc!=IntPtr.Zero)Marshal.FreeHGlobal(desc);N.Release(ref advanced);}}
 IntPtr device,context,duplication,staging;internal N.OutputDesc Description;internal int CaptureIndex;int sourceWidth,sourceHeight;Bitmap last;VideoProcessor converter;bool converterAttempted;internal string Conversion="software-bgra-nv12";internal string ConversionFallback;
 internal DesktopCapture(string name,int requestedIndex){IntPtr factory=IntPtr.Zero,adapter=IntPtr.Zero,output=IntPtr.Zero,output1=IntPtr.Zero;try{
  Guid iid=new Guid("770aae78-f26f-4dba-a829-253c83d1b387");N.Check(N.CreateDXGIFactory1(ref iid,out factory));int flat=0;bool found=false;
  for(int a=0;!found;a++){int hr=N.Method<N.IndexPointer>(factory,12)(factory,a,out adapter);if(hr==unchecked((int)0x887a0002))break;N.Check(hr);try{
   for(int o=0;!found;o++){hr=N.Method<N.IndexPointer>(adapter,7)(adapter,o,out output);if(hr==unchecked((int)0x887a0002))break;N.Check(hr);try{
    N.OutputDesc desc;N.Check(N.Method<N.GetOutputDesc>(output,7)(output,out desc));int index=flat++;
    if(desc.attached==0||(!String.IsNullOrEmpty(name)?desc.name!=name:index!=requestedIndex))continue;
    if(requestedIndex>=0&&!String.IsNullOrEmpty(name)&&index!=requestedIndex)throw new Exception("MONITOR_MAPPING_CONFLICT");
    CheckSdr(output);Description=desc;CaptureIndex=index;int level;N.Check(N.D3D11CreateDevice(adapter,0,IntPtr.Zero,0x20,IntPtr.Zero,0,7,out device,out level,out context));
    output1=N.Query(output,"00cddea8-939b-4b83-a340-a685226666cc");N.Check(N.Method<N.Duplicate>(output1,22)(output1,device,out duplication));found=true;
   }finally{N.Release(ref output1);N.Release(ref output);}}
  }finally{N.Release(ref adapter);}}
  if(!found)throw new Exception("MONITOR_NOT_FOUND");
 }catch{Dispose();throw;}finally{N.Release(ref factory);}}
 internal bool Capture(){IntPtr resource=IntPtr.Zero,texture=IntPtr.Zero;N.FrameInfo info;int hr=N.Method<N.Acquire>(duplication,8)(duplication,0,out info,out resource);if(hr==unchecked((int)0x887a0027))return false;N.Check(hr);
 try{if(info.protectedContent!=0)throw new Exception("PROTECTED_CONTENT");
  if(info.mouse!=0){pointerX=info.x;pointerY=info.y;pointerVisible=info.visible!=0;}
  if(info.pointerSize>0){if(info.pointerSize>4*1024*1024)throw new Exception("POINTER_TOO_LARGE");pointer=new byte[info.pointerSize];var handle=GCHandle.Alloc(pointer,GCHandleType.Pinned);try{int required;N.Check(N.Method<GetPointer>(duplication,11)(duplication,pointer.Length,handle.AddrOfPinnedObject(),out required,out pointerShape));}finally{handle.Free();}}
  texture=N.Query(resource,"6f15aaf2-d208-4e89-9ab4-489535d34f9c");N.TextureDesc desc;N.Method<N.GetTextureDesc>(texture,10)(texture,out desc);
  if(staging==IntPtr.Zero){sourceWidth=desc.width;sourceHeight=desc.height;desc.usage=3;desc.bind=0;desc.cpu=0x20000;desc.misc=0;N.Check(N.Method<N.CreateTexture>(device,5)(device,ref desc,IntPtr.Zero,out staging));}
  if(desc.width!=sourceWidth||desc.height!=sourceHeight)throw new Exception("DISPLAY_CHANGED");
  N.Method<N.CopyResource>(context,47)(context,staging,texture);N.Mapped map;N.Check(N.Method<N.Map>(context,14)(context,staging,0,1,0,out map));
  try{using(var source=new Bitmap(sourceWidth,sourceHeight,map.rowPitch,PixelFormat.Format32bppArgb,map.data)){
   var next=source.Clone(new Rectangle(0,0,sourceWidth,sourceHeight),PixelFormat.Format32bppArgb);
   if(Description.rotation==2)next.RotateFlip(RotateFlipType.Rotate90FlipNone);else if(Description.rotation==3)next.RotateFlip(RotateFlipType.Rotate180FlipNone);else if(Description.rotation==4)next.RotateFlip(RotateFlipType.Rotate270FlipNone);
   if(last!=null)last.Dispose();last=next;
  }}finally{N.Method<N.Unmap>(context,15)(context,staging,0);}
  return true;
 }finally{N.Release(ref texture);N.Release(ref resource);N.Check(N.Method<N.Empty>(duplication,14)(duplication));}}
 internal byte[] Frame(){if(last==null)return null;using(var composed=last.Clone(new Rectangle(0,0,last.Width,last.Height),PixelFormat.Format32bppArgb)){DrawPointer(composed);if(!converterAttempted){converterAttempted=true;try{converter=new VideoProcessor(device,context,last.Width,last.Height);Conversion="d3d11-video-processor";}catch(Exception e){ConversionFallback=e.Message;}}if(converter!=null)return converter.Convert(composed);using(var scaled=new Bitmap(1920,1080,PixelFormat.Format32bppArgb)){
  using(var g=Graphics.FromImage(scaled)){g.Clear(Color.Black);double ratio=Math.Min(1920.0/last.Width,1080.0/last.Height);int w=(int)(last.Width*ratio),h=(int)(last.Height*ratio);g.DrawImage(composed,(1920-w)/2,(1080-h)/2,w,h);}
  var bits=scaled.LockBits(new Rectangle(0,0,1920,1080),ImageLockMode.ReadOnly,PixelFormat.Format32bppArgb);try{return ToNv12(bits.Scan0,bits.Stride);}finally{scaled.UnlockBits(bits);}
 }}}
 unsafe void DrawPointer(Bitmap bitmap){if(!pointerVisible||pointer==null)return;int height=pointerShape.type==1?pointerShape.height/2:pointerShape.height;var bits=bitmap.LockBits(new Rectangle(0,0,bitmap.Width,bitmap.Height),ImageLockMode.ReadWrite,PixelFormat.Format32bppArgb);try{
  for(int y=0;y<height;y++)for(int x=0;x<pointerShape.width;x++){int tx=pointerX+x,ty=pointerY+y;if(tx<0||ty<0||tx>=bitmap.Width||ty>=bitmap.Height)continue;byte* p=(byte*)bits.Scan0+ty*bits.Stride+tx*4;
   if(pointerShape.type==1){int andIndex=y*pointerShape.pitch+x/8,xorIndex=(y+height)*pointerShape.pitch+x/8;if(xorIndex>=pointer.Length)throw new Exception("INVALID_POINTER_SHAPE");int mask=0x80>>(x%8),a=(pointer[andIndex]&mask)!=0?255:0,b=(pointer[xorIndex]&mask)!=0?255:0;for(int c=0;c<3;c++)p[c]=(byte)((p[c]&a)^b);}
   else{int i=y*pointerShape.pitch+x*4;if(i+3>=pointer.Length)throw new Exception("INVALID_POINTER_SHAPE");int alpha=pointer[i+3];for(int c=0;c<3;c++)p[c]=pointerShape.type==4?(alpha==0?pointer[i+c]:(byte)(p[c]^pointer[i+c])):(byte)((pointer[i+c]*alpha+p[c]*(255-alpha)+127)/255);}
  }
 }finally{bitmap.UnlockBits(bits);}}
 static byte Clip(int v){return (byte)Math.Max(0,Math.Min(255,v));}
 static unsafe byte[] ToNv12(IntPtr data,int stride){const int w=1920,h=1080;byte[] result=new byte[w*h*3/2];byte* start=(byte*)data;for(int y=0;y<h;y+=2)for(int x=0;x<w;x+=2){int sumU=0,sumV=0;for(int dy=0;dy<2;dy++)for(int dx=0;dx<2;dx++){byte* p=start+(y+dy)*stride+(x+dx)*4;int b=p[0],g=p[1],r=p[2];result[(y+dy)*w+x+dx]=Clip(((66*r+129*g+25*b+128)>>8)+16);sumU+=((-38*r-74*g+112*b+128)>>8)+128;sumV+=((112*r-94*g-18*b+128)>>8)+128;}int uv=w*h+y/2*w+x;result[uv]=Clip(sumU/4);result[uv+1]=Clip(sumV/4);}return result;}
 public void Dispose(){if(converter!=null){converter.Dispose();converter=null;}if(last!=null){last.Dispose();last=null;}N.Release(ref staging);N.Release(ref duplication);N.Release(ref context);N.Release(ref device);}
}

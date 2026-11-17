using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using N=MediaNative;

internal sealed class Mp4Writer:IDisposable {
 IntPtr writer;int stream;internal bool? HardwareAccelerated;internal string Encoder="Media Foundation H.264";internal string FallbackReason;
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int GetTransform(IntPtr p,int stream,int index,out Guid category,out IntPtr transform);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int GetString(IntPtr p,ref Guid key,out IntPtr value,out int length);
 static string AttributeString(IntPtr p,string name){Guid key=new Guid(name);IntPtr text=IntPtr.Zero;int length;try{int hr=N.Method<GetString>(p,13)(p,ref key,out text,out length);return hr<0?null:Marshal.PtrToStringUni(text,length);}finally{if(text!=IntPtr.Zero)Marshal.FreeCoTaskMem(text);}}
 internal static Mp4Writer Open(string file,int fps,bool software){try{return new Mp4Writer(file,fps,!software);}catch(Exception e){if(software)throw;var writer=new Mp4Writer(file,fps,false);writer.FallbackReason=e.Message;return writer;}}
 internal Mp4Writer(string file,int fps,bool hardware){IntPtr attributes=IntPtr.Zero,input=IntPtr.Zero,output=IntPtr.Zero;try{
  N.Check(N.MFCreateAttributes(out attributes,2));N.U32(attributes,"a634a91c-822b-41b9-a494-4de4643612b0",hardware?1:0);
  N.Check(N.MFCreateSinkWriterFromURL(file,IntPtr.Zero,attributes,out writer));
  output=N.VideoType(N.H264,1920,1080,fps);N.U32(output,"20332624-fb0d-4d9e-bd0d-cbf6786c102e",8000000);
  N.Check(N.Method<N.AddStream>(writer,3)(writer,output,out stream));input=N.VideoType(N.NV12,1920,1080,fps);
  N.Check(N.Method<N.SetInput>(writer,4)(writer,stream,input,IntPtr.Zero));N.Check(N.Method<N.Empty>(writer,5)(writer));
  IntPtr extended=IntPtr.Zero,transform=IntPtr.Zero,attrs=IntPtr.Zero;try{extended=N.Query(writer,"588d72ab-5bc1-496a-8714-b70617141b25");for(int i=0;i<16;i++){Guid category;int hr=N.Method<GetTransform>(extended,14)(extended,stream,i,out category,out transform);if(hr<0)break;try{if(category!=new Guid("f79eac7d-e545-4387-bdee-d647d7bde42a"))continue;if(N.Method<N.OutPointer>(transform,8)(transform,out attrs)>=0){string url=AttributeString(attrs,"2fb866ac-b078-4942-ab6c-003d05cda674");HardwareAccelerated=!String.IsNullOrEmpty(url);Encoder=AttributeString(attrs,"314ffbae-5b41-4c95-9c19-4e7d586face3")??Encoder;}}finally{N.Release(ref attrs);N.Release(ref transform);}}}finally{N.Release(ref extended);}
  if(!hardware)HardwareAccelerated=false;
 }catch{Dispose();throw;}finally{N.Release(ref attributes);N.Release(ref input);N.Release(ref output);}}
 internal void Write(byte[] bytes,long timestamp,long duration){IntPtr buffer=IntPtr.Zero,sample=IntPtr.Zero;try{
  N.Check(N.MFCreateMemoryBuffer(bytes.Length,out buffer));IntPtr data;int max,length;N.Check(N.Method<N.BufferLock>(buffer,3)(buffer,out data,out max,out length));try{Marshal.Copy(bytes,0,data,bytes.Length);}finally{N.Check(N.Method<N.Empty>(buffer,4)(buffer));}
  N.Check(N.Method<N.Integer>(buffer,6)(buffer,bytes.Length));N.Check(N.MFCreateSample(out sample));N.Check(N.Method<N.Pointer>(sample,42)(sample,buffer));N.Check(N.Method<N.Time>(sample,36)(sample,timestamp));N.Check(N.Method<N.Time>(sample,38)(sample,duration));N.Check(N.Method<N.WriteSample>(writer,6)(writer,stream,sample));
 }finally{N.Release(ref sample);N.Release(ref buffer);}}
 internal void Finish(){N.Check(N.Method<N.Empty>(writer,11)(writer));}
 public void Dispose(){N.Release(ref writer);}
}
internal static class MediaVerifier {
 internal static object Verify(string file){IntPtr reader=IntPtr.Zero,type=IntPtr.Zero;try{
  N.Check(N.MFCreateSourceReaderFromURL(file,IntPtr.Zero,out reader));int video=-1,audio=0,width=0,height=0;Guid key=new Guid(N.Major),subkey=new Guid(N.Subtype);
  for(int i=0;i<32;i++){int hr=N.Method<N.NativeType>(reader,5)(reader,i,0,out type);if(hr==unchecked((int)0xc00d36b3))break;N.Check(hr);try{Guid major;N.Check(N.Method<N.GetGuid>(type,10)(type,ref key,out major));if(major==new Guid(N.Video)){if(video!=-1)throw new Exception("Multiple video streams");video=i;Guid sub;N.Check(N.Method<N.GetGuid>(type,10)(type,ref subkey,out sub));if(sub!=new Guid(N.H264))throw new Exception("Expected H.264");long size;Guid sizekey=new Guid(N.Size);N.Check(N.Method<N.GetU64>(type,8)(type,ref sizekey,out size));width=(int)(size>>32);height=(int)size;}else if(major==new Guid("73647561-0000-0010-8000-00aa00389b71"))audio++;}finally{N.Release(ref type);}}
  if(video<0||audio!=0)throw new Exception("Expected video-only MP4");
  N.Check(N.Method<N.StreamSelection>(reader,4)(reader,unchecked((int)0xfffffffe),0));N.Check(N.Method<N.StreamSelection>(reader,4)(reader,video,1));
  N.Check(N.MFCreateMediaType(out type));N.GUID(type,N.Major,N.Video);N.GUID(type,N.Subtype,N.NV12);N.Check(N.Method<N.ReaderType>(reader,7)(reader,video,IntPtr.Zero,type));N.Release(ref type);
  int frames=0;long last=-1,end=0;
  while(true){IntPtr sample=IntPtr.Zero;int actual,flags;long time;N.Check(N.Method<N.ReadSample>(reader,9)(reader,video,0,out actual,out flags,out time,out sample));try{
   if((flags&1)!=0)throw new Exception("Decoder reported an error");
   if(sample!=IntPtr.Zero){if(time<last)throw new Exception("Non-monotonic video timestamps");last=time;frames++;long duration;N.Check(N.Method<GetTime>(sample,37)(sample,out duration));end=time+duration;}
   if((flags&2)!=0)break;
  }finally{N.Release(ref sample);}}
  if(frames==0)throw new Exception("Empty video");return new {codec="h264",width,height,audioStreams=audio,decodedFrames=frames,durationSeconds=end/10000000.0,decoded=true,verification="media-foundation-full-decode"};
 }finally{N.Release(ref type);N.Release(ref reader);}}
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int GetTime(IntPtr p,out long value);
}

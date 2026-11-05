import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { PrismaClient } from '@prisma/client';
import { Buffer } from 'node:buffer';

export const COMMS_ATTACHMENT_BUCKET = 'ryanai-comms-attachments';
export const COMMS_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
export const COMMS_ATTACHMENT_MAX_FILES = 8;
export const COMMS_ATTACHMENT_MAX_MESSAGE_BYTES = 40 * 1024 * 1024;

const TYPES: Record<string,{ext:string;signature:(b:Uint8Array)=>boolean}> = {
  'image/png':{ext:'png',signature:b=>b.length>=8&&b[0]===137&&b[1]===80&&b[2]===78&&b[3]===71&&b[4]===13&&b[5]===10&&b[6]===26&&b[7]===10},
  'image/jpeg':{ext:'jpg',signature:b=>b.length>=3&&b[0]===255&&b[1]===216&&b[2]===255},
  'image/gif':{ext:'gif',signature:b=>Buffer.from(b.slice(0,6)).toString('ascii').startsWith('GIF8')},
  'image/webp':{ext:'webp',signature:b=>b.length>=12&&Buffer.from(b.slice(0,4)).toString('ascii')==='RIFF'&&Buffer.from(b.slice(8,12)).toString('ascii')==='WEBP'},
  'video/mp4':{ext:'mp4',signature:b=>b.length>=12&&Buffer.from(b.slice(4,8)).toString('ascii')==='ftyp'},
  'video/webm':{ext:'webm',signature:b=>b.length>=4&&b[0]===26&&b[1]===69&&b[2]===223&&b[3]===163},
  'audio/mpeg':{ext:'mp3',signature:b=>b.length>=3&&(Buffer.from(b.slice(0,3)).toString('ascii')==='ID3'||(b[0]===255&&(b[1]&224)===224))},
  'audio/wav':{ext:'wav',signature:b=>b.length>=12&&Buffer.from(b.slice(0,4)).toString('ascii')==='RIFF'&&Buffer.from(b.slice(8,12)).toString('ascii')==='WAVE'},
  'audio/ogg':{ext:'ogg',signature:b=>b.length>=4&&Buffer.from(b.slice(0,4)).toString('ascii')==='OggS'},
  'audio/mp4':{ext:'m4a',signature:b=>b.length>=12&&Buffer.from(b.slice(4,8)).toString('ascii')==='ftyp'},
  'application/pdf':{ext:'pdf',signature:b=>Buffer.from(b.slice(0,5)).toString('ascii')==='%PDF-'},
  'application/zip':{ext:'zip',signature:b=>b.length>=4&&b[0]===80&&b[1]===75&&[3,5,7].includes(b[2])},
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':{ext:'docx',signature:b=>b.length>=4&&b[0]===80&&b[1]===75},
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':{ext:'xlsx',signature:b=>b.length>=4&&b[0]===80&&b[1]===75},
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':{ext:'pptx',signature:b=>b.length>=4&&b[0]===80&&b[1]===75},
  'text/plain':{ext:'txt',signature:isText},'text/markdown':{ext:'md',signature:isText},'text/csv':{ext:'csv',signature:isText},
  'application/json':{ext:'json',signature:isText},'application/xml':{ext:'xml',signature:isText},
  'text/javascript':{ext:'js',signature:isText},'text/typescript':{ext:'ts',signature:isText},
  'text/x-python':{ext:'py',signature:isText},'text/x-go':{ext:'go',signature:isText},'text/x-rust':{ext:'rs',signature:isText},
  'text/x-java':{ext:'java',signature:isText},'text/css':{ext:'css',signature:isText},
};
function isText(b:Uint8Array):boolean {
  if(!b.length||b.includes(0))return false;
  try{new TextDecoder('utf-8',{fatal:true}).decode(b.slice(0,Math.min(b.length,4096)));return true;}catch{return false;}
}
export function validateCommsFileSignature(bytes:Uint8Array,mime:string):boolean {
  const rule=TYPES[mime.toLowerCase()];return Boolean(rule&&bytes.length&&rule.signature(bytes));
}
export function safeCommsFileName(name:string,mime:string):string {
  const leaf=name.split(/[\\/]/).pop()??'attachment';
  const base=leaf.normalize('NFKC').replace(/\.[^.]*$/,'').replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,80)||'attachment';
  const ext=TYPES[mime.toLowerCase()]?.ext;if(!ext)throw new Error('Unsupported attachment MIME type.');
  return base+'.'+ext;
}
export interface CommsAttachmentDescriptor {name:string;mimeType:string;size:number}
export function validateCommsAttachmentDescriptors(files:readonly CommsAttachmentDescriptor[]):void {
  if(!files.length||files.length>COMMS_ATTACHMENT_MAX_FILES)throw new Error('Choose between 1 and 8 attachments.');
  const total=files.reduce((n,f)=>n+f.size,0);
  if(!Number.isSafeInteger(total)||total>COMMS_ATTACHMENT_MAX_MESSAGE_BYTES)throw new Error('Combined attachments exceed 40 MiB.');
  for(const f of files){
    const rule=TYPES[f.mimeType.toLowerCase()];
    if(!rule||!Number.isSafeInteger(f.size)||f.size<=0||f.size>COMMS_ATTACHMENT_MAX_BYTES)throw new Error('Each attachment must be a supported type no larger than 20 MiB.');
    const ext=f.name.split('.').pop()?.toLowerCase();
    if(ext!==rule.ext&&!(rule.ext==='jpg'&&ext==='jpeg'))throw new Error('File extension does not match its MIME type.');
  }
}
export function createCommsStorageAdmin():SupabaseClient {
  const url=process.env.SUPABASE_URL?.trim(),key=process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if(!url||!key)throw new Error('Private Comms attachment storage is not configured.');
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
async function boundedDownload(response:Response):Promise<Buffer> {
  if(!response.ok)throw new Error('Provider attachment download failed.');
  const length=Number(response.headers.get('content-length')||0);
  if(length>COMMS_ATTACHMENT_MAX_BYTES||!response.body)throw new Error('Provider attachment exceeds the 20 MiB limit or is empty.');
  const reader=response.body.getReader();const chunks:Buffer[]=[];let total=0;
  try{while(true){const{done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>COMMS_ATTACHMENT_MAX_BYTES){await reader.cancel();throw new Error('Provider attachment exceeds 20 MiB.');}chunks.push(Buffer.from(value));}}
  finally{reader.releaseLock();}
  if(!total)throw new Error('Provider attachment is empty.');
  return Buffer.concat(chunks,total);
}
export async function downloadTwilioMedia(rawUrl:string,expectedMime:string):Promise<Buffer> {
  const sid=process.env.TWILIO_ACCOUNT_SID?.trim(),token=process.env.TWILIO_AUTH_TOKEN?.trim();
  if(!sid||!token)throw new Error('Twilio media credentials are missing.');
  const url=new URL(rawUrl);
  if(url.protocol!=='https:'||url.hostname!=='api.twilio.com'||!url.pathname.startsWith('/2010-04-01/Accounts/'+sid+'/Messages/')||! /\/Media\/ME[a-zA-Z0-9]+\/?$/.test(url.pathname))throw new Error('Twilio media URL is not trusted.');
  const auth=Buffer.from(sid+':'+token).toString('base64');
  const response=await fetch(url,{headers:{Authorization:'Basic '+auth},redirect:'error',signal:AbortSignal.timeout(20000)});
  const declared=response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if(declared&&declared!==expectedMime.toLowerCase()&&declared!=='application/octet-stream')throw new Error('Twilio media MIME mismatch.');
  return boundedDownload(response);
}
function allowedResendHost(host:string):boolean {
  const h=host.toLowerCase();return h==='resend.com'||h.endsWith('.resend.com')||h.endsWith('.amazonaws.com')||h.endsWith('.cloudfront.net')||h.endsWith('.r2.cloudflarestorage.com');
}
export async function downloadResendMedia(rawUrl:string):Promise<Buffer> {
  let url=new URL(rawUrl);
  for(let i=0;i<=3;i++){
    if(url.protocol!=='https:'||!allowedResendHost(url.hostname)||url.username||url.password)throw new Error('Resend media URL host is not trusted.');
    const res=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(20000)});
    if(![301,302,303,307,308].includes(res.status))return boundedDownload(res);
    const loc=res.headers.get('location');if(!loc)throw new Error('Invalid Resend media redirect.');
    url=new URL(loc,url);
  }
  throw new Error('Resend media redirect limit exceeded.');
}
export async function createCommsUploadIntents(prisma:PrismaClient,ownerUserId:string,messageId:string,files:readonly CommsAttachmentDescriptor[]) {
  validateCommsAttachmentDescriptors(files);
  const msg=await prisma.communicationMessage.findUnique({where:{id:messageId},select:{id:true,conversationId:true,conversation:{select:{ownerUserId:true}}}});
  if(!msg||msg.conversation.ownerUserId!==ownerUserId)throw new Error('Communication draft is not owned by this session.');
  const storage=createCommsStorageAdmin(),created:string[]=[];
  const intents:Array<{id:string;name:string;mimeType:string;size:number;signedUploadUrl:string}>=[];
  try{
    for(const file of files){
      const id=crypto.randomUUID(),name=safeCommsFileName(file.name,file.mimeType);
      const objectName=ownerUserId+'/'+msg.conversationId+'/'+msg.id+'/'+id+'-'+name;
      await prisma.communicationAttachment.create({data:{id,communicationMessageId:msg.id,ownerUserId,bucketId:COMMS_ATTACHMENT_BUCKET,objectName,fileName:name,mimeType:file.mimeType.toLowerCase(),size:BigInt(file.size),source:'outbound_upload'}});
      created.push(id);
      const {data,error}=await storage.storage.from(COMMS_ATTACHMENT_BUCKET).createSignedUploadUrl(objectName,{upsert:false});
      if(error||!data?.signedUrl)throw new Error(error?.message||'Unable to sign attachment upload.');
      intents.push({id,name,mimeType:file.mimeType.toLowerCase(),size:file.size,signedUploadUrl:data.signedUrl});
    }
    return intents;
  }catch(error){if(created.length)await prisma.communicationAttachment.deleteMany({where:{id:{in:created}}});throw error;}
}
export async function storeInboundCommsAttachment(prisma:PrismaClient,input:{ownerUserId:string;messageId:string;conversationId:string;fileName:string;mimeType:string;bytes:Uint8Array;source:'inbound_twilio'|'inbound_resend';providerMediaId?:string}) {
  const mime=input.mimeType.toLowerCase(),bytes=Buffer.from(input.bytes);
  if(bytes.length>COMMS_ATTACHMENT_MAX_BYTES||!validateCommsFileSignature(bytes,mime))throw new Error('Inbound attachment signature or size is invalid.');
  const msg=await prisma.communicationMessage.findUnique({where:{id:input.messageId},select:{id:true,conversationId:true,conversation:{select:{ownerUserId:true}}}});
  if(!msg||msg.conversationId!==input.conversationId||msg.conversation.ownerUserId!==input.ownerUserId)throw new Error('Inbound attachment has no verified owner-bound message.');
  const id=crypto.randomUUID(),name=safeCommsFileName(input.fileName,mime),objectName=input.ownerUserId+'/'+input.conversationId+'/'+input.messageId+'/'+id+'-'+name;
  const storage=createCommsStorageAdmin();
  await prisma.communicationAttachment.create({data:{id,communicationMessageId:input.messageId,ownerUserId:input.ownerUserId,bucketId:COMMS_ATTACHMENT_BUCKET,objectName,fileName:name,mimeType:mime,size:BigInt(bytes.length),source:input.source,...(input.providerMediaId?{providerMediaId:input.providerMediaId}:{})}});
  const {error}=await storage.storage.from(COMMS_ATTACHMENT_BUCKET).upload(objectName,bytes,{contentType:mime,cacheControl:'60',upsert:false});
  if(error){await prisma.communicationAttachment.delete({where:{id}});throw new Error(error.message||'Unable to store provider attachment.');}
  return {id,name,mimeType:mime,size:bytes.length};
}
export async function getCommsAttachmentScanStates(storage:SupabaseClient,attachments:readonly {id:string;objectName:string}[]):Promise<Record<string,string>> {
  if(!attachments.length)return {};
  const {data,error}=await storage.from('ryanai_attachment_scans').select('object_name,status').eq('bucket_id',COMMS_ATTACHMENT_BUCKET).in('object_name',attachments.map(a=>a.objectName));
  if(error)throw error;const map=new Map((data??[]).map((x:any)=>[x.object_name,x.status]));
  return Object.fromEntries(attachments.map(a=>[a.id,map.get(a.objectName)||'pending']));
}
export async function cleanCommsAttachmentUrls(prisma:PrismaClient,ownerUserId:string,ids:readonly string[],expiresIn=900):Promise<Map<string,string>> {
  const rows=await prisma.communicationAttachment.findMany({where:{id:{in:[...ids]},ownerUserId,bucketId:COMMS_ATTACHMENT_BUCKET},select:{id:true,objectName:true,message:{select:{conversation:{select:{ownerUserId:true}}}}}});
  if(rows.length!==new Set(ids).size||rows.some(r=>r.message.conversation.ownerUserId!==ownerUserId))throw new Error('One or more attachments do not belong to this owner.');
  const storage=createCommsStorageAdmin(),states=await getCommsAttachmentScanStates(storage,rows);
  if(rows.some(r=>states[r.id]!=='clean'))throw new Error('Attachments are unavailable until every security scan is clean.');
  const urls=new Map<string,string>();
  for(const row of rows){const {data,error}=await storage.storage.from(COMMS_ATTACHMENT_BUCKET).createSignedUrl(row.objectName,expiresIn);if(error||!data?.signedUrl)throw new Error(error?.message||'Unable to sign attachment URL.');urls.set(row.id,data.signedUrl);}
  return urls;
}
export function getOwnerInboundUserId():string|null {
  const value=process.env.RYANAI_OWNER_AUTH_USER_ID?.trim();
  return value&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)?value:null;
}

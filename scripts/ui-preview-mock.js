(function(){
const now=Date.now(), H=3600e3
const settings={preset:'full',userName:'Om Prakash',language:'Japanese + English',asrEngine:'auto',sherpaThreads:6,whisperModel:'large-v3-turbo',cloudAsrProvider:'gemini',cloudAsrModel:'gemini-flash-latest',diarization:true,inRoomMode:false,echoFilter:true,captureSystemAudio:true,micDeviceId:'default',aiProvider:'local',geminiModel:'gemini-flash-latest',openaiBaseUrl:'https://api.openai.com/v1',openaiModel:'gpt-4o-mini',llmModel:'gemma-4-E4B',gpuBackend:'cuda',gpuLayers:99,contextSize:32768,extraLlamaArgs:'',liveAssist:true,topicAssist:true,liveAssistThreshold:0.45,noteTemplate:'client',indexImages:false,embedDims:768,retentionDays:30,hotkey:'CommandOrControl+Shift+Space',hfToken:'',theme:window.__THEME||'light'}
const meetings=[
 {id:'m1',title:'Byokessai console review with client',createdAt:now-2*H,durationMs:2710000,status:'done',preview:'Credit-company matching rules, keigo talk scripts for call staff, campaign dashboard for Q4'},
 {id:'m2',title:'DX team weekly sync',createdAt:now-26*H,durationMs:1820000,status:'done',preview:'Hyogo roster OCR accuracy, Gemini proxy vault rollout, AXIS dashboard deadlines'},
 {id:'m3',title:'Cuein Studio stand design brief',createdAt:now-5*24*H,durationMs:3300000,status:'done',preview:'Exhibition stand 6x4 m, LED wall, budget and build schedule for the Tokyo expo'}]
const cit=(n,title,path,loc,snippet,kind='file')=>({n,chunkId:'c'+n+title,title,path,loc,snippet,kind,label:'Clients',score:.71})
const meeting={id:'m1',title:'Byokessai console review with client',createdAt:now-2*H,durationMs:2710000,status:'done',template:'client',
 notes:'- matching rules: income band?\n- keigo scripts → who reviews\n- Q4 campaign numbers\n- next demo date',
 enhanced:'## Matching rules\n- Customers are matched to credit companies by **income band and employment type**; Tanaka-san asked to add *years at current employer* as a third rule [12:40].\n- Edge case: self-employed applicants should go to Orient and Aplus only.\n\n## Keigo talk scripts\n- Scripts stay in 謙譲語 for first contact; **Sato-san (call-centre lead) reviews** every new script before release.\n- Om to add a "softer refusal" variant for declined applications.\n\n## Q4 campaign\n- LINE campaign converted at **3.8%** vs 2.1% for email; budget shifts 60/40 toward LINE.\n\n## Action items\n- **Om** – add employer-tenure rule and refusal script – by Oct 24\n- **Sato-san** – review scripts – by Oct 28\n- **Tanaka-san** – send Q4 campaign export\n\n## Decisions\n- Next demo on **Nov 4, 10:00** at the Osaka office.',
 speakers:{S1:'Tanaka-san',S2:'Sato-san'},
 transcript:[
  {id:'t1',channel:'system',speaker:'Tanaka-san',speakerId:'S1',startMs:752000,endMs:760000,text:'マッチングのルールですが、収入帯と雇用形態に加えて、勤続年数も入れられますか？'},
  {id:'t2',channel:'mic',speaker:'Om Prakash',startMs:761000,endMs:770000,text:'はい、可能です。来週までに勤続年数のルールを追加します。'},
  {id:'t3',channel:'system',speaker:'Sato-san',speakerId:'S2',startMs:771000,endMs:781000,text:'Also, for the talk scripts, I would like to review every new one before it goes live. Is that okay?'},
  {id:'t4',channel:'system',speaker:'Sato-san',speakerId:'S2',startMs:782000,endMs:789000,text:'Especially the refusal script for declined applications.'},
  {id:'t5',channel:'mic',speaker:'Om Prakash',startMs:790000,endMs:799000,text:'Of course. I will add a softer refusal variant and send it to you first.'},
  {id:'t6',channel:'system',speaker:'Tanaka-san',speakerId:'S1',startMs:801000,endMs:812000,text:'What was the conversion rate of the LINE campaign last quarter?'}],
 assist:[
  {id:'a1',kind:'context',atMs:771000,question:'for the talk scripts, I would like to review every new one before it goes live',answer:'',citations:[cit(1,'Keigo talk scripts v3.docx','C:/Clients/Byokessai/Keigo talk scripts v3.docx','','第一声は謙譲語で統一。お断りの際は「誠に恐れ入りますが」から始める。改訂時はコールセンター責任者の確認を経ること。')]},
  {id:'a2',kind:'answer',atMs:801000,question:'What was the conversion rate of the LINE campaign last quarter?',answer:'The LINE campaign converted at **3.8%** in Q3, versus 2.1% for email [1].',citations:[cit(1,'Q3 campaign report.xlsx','C:/Clients/Byokessai/Q3 campaign report.xlsx','Sheet Summary','Channel,Sent,Converted,Rate\nLINE,12400,471,3.8%\nEmail,18900,397,2.1%')]}],
 cloudUsed:[]}
const sources=[
 {id:'s1',type:'folder',path:'C:\\Clients\\Byokessai',label:'Clients',addedAt:now,fileCount:48,chunkCount:612,status:'ready'},
 {id:'s2',type:'folder',path:'G:\\My Drive\\JMC DX Team',label:'JMC',addedAt:now,fileCount:213,chunkCount:2840,status:'indexing',progress:{done:131,total:213}},
 {id:'s3',type:'calendar',path:'C:\\Users\\om\\Downloads\\work-calendar.ics',label:'Calendar',addedAt:now,fileCount:1,chunkCount:86,status:'ready'},
 {id:'s4',type:'bookmarks',path:'C:\\Users\\om\\Documents\\bookmarks.html',label:'Research',addedAt:now,fileCount:1,chunkCount:342,status:'ready'}]
const hits=[
 {chunkId:'h1',title:'Q3 campaign report.xlsx',path:'C:/x/Q3 campaign report.xlsx',loc:'Sheet Summary',text:'Channel,Sent,Converted,Rate LINE,12400,471,3.8% Email,18900,397,2.1%',kind:'file',label:'Clients',sourceId:'s1',score:.74},
 {chunkId:'h2',title:'Byokessai proposal.pdf',path:'C:/x/Byokessai proposal.pdf',loc:'Page 4',text:'The console matches each applicant to eligible credit companies using income band, employment type and existing obligations.',kind:'file',label:'Clients',sourceId:'s1',score:.62},
 {chunkId:'h3',title:'Kickoff deck.pptx',path:'C:/x/Kickoff deck.pptx',loc:'Slide 7',text:'Phase 2: keigo talk scripts, refusal flows, LINE campaign dashboard.',kind:'file',label:'Clients',sourceId:'s1',score:.55}]
const chat=window.__CHAT?[
 {id:'q1',role:'user',content:'What did we agree with Byokessai about the talk scripts?',createdAt:now},
 {id:'r1',role:'assistant',content:'Sato-san (call-centre lead) will **review every new script before release** [1], and you agreed to add a softer refusal variant for declined applications by Oct 24 [1]. The current scripts already require 謙譲語 for first contact and a supervisor check on revisions [2].',citations:[cit(1,'Byokessai console review with client','', 'Enhanced notes','Sato-san reviews every new script before release; Om to add a softer refusal variant.','meeting'),cit(2,'Keigo talk scripts v3.docx','C:/x/Keigo talk scripts v3.docx','','第一声は謙譲語で統一。改訂時はコールセンター責任者の確認を経ること。')],createdAt:now}]:[]
const components=['llamaRuntime','embedder','sensevoice','speaker','llm'].map(id=>({id,name:{llamaRuntime:'llama.cpp runtime (CUDA)',embedder:'EmbeddingGemma 2 (740M) - search and Live Assistance',sensevoice:'SenseVoice Small (Japanese, English, Chinese, Korean, Cantonese)',speaker:'3D-Speaker CAM++ voice model (speaker labels)',llm:'Gemma 4 E4B (Q8_0) - recommended, 10 GB+ VRAM'}[id],description:'',installed:id!=='llm'||!window.__SETUP,required:true,sizeHint:'~0.8 GB',downloading:id==='llm'&&window.__SETUP?{received:3.1e9,total:8.4e9,file:'gemma-4-E4B-it-Q8_0.gguf'}:undefined}))
  .concat([{id:'parakeet',name:'Parakeet TDT 0.6B v3 (25 European languages incl. English, Dutch)',description:'Fast local speech recognition (sherpa-onnx, CPU)',installed:false,required:false,sizeHint:'~640 MB'}])
const R={'settings:get':settings,'settings:set':settings,'components:list':components,'runtime:status':{llm:'ready',embedder:'ready',whisper:'stopped',asr:'SenseVoice (JA/EN/ZH/KO, fast on CPU)'},
 'meetings:list':meetings,'meetings:get':meeting,'sources:list':sources,'search':hits,'chat:history':chat,'app:home':'C:\\Users\\om\\AppData\\Local\\Insight',
 'secrets:status':{gemini:true,openai:false},'hardware:detect':{gpus:[{name:'NVIDIA GeForce RTX 4070 Laptop GPU',vendor:'nvidia',vramMB:8188}],ramGB:32,cores:16,recommended:'balanced',reason:'NVIDIA GeForce RTX 4070 Laptop GPU (8 GB) fits Gemma 4 E4B at 4-bit.'}}
window.insight={invoke:async(ch)=>R[ch]===undefined?null:JSON.parse(JSON.stringify(R[ch])),on:()=>()=>{},sendSegment:()=>{}}
})()

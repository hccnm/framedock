import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { codexImageInput, generateCodexImage } from '../../canvas-agent/src/agent/codex-image.ts';
const directory = new URL('.', import.meta.url);
const server=createServer(async(req,res)=>{
    res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:4189');
    res.setHeader('Access-Control-Allow-Headers','content-type');
    if(req.method==='OPTIONS'){res.writeHead(204).end();return;}
    const url=new URL(req.url||'/', 'http://127.0.0.1:17489');
    if(url.pathname!=='/agent/codex/image'||req.method!=='POST'||url.searchParams.get('token')!=='channel-verification'){res.writeHead(404).end();return;}
    const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort();});
    const started=Date.now();
    try {
        const chunks=[];for await(const chunk of req)chunks.push(chunk);
        const input=codexImageInput.parse(JSON.parse(Buffer.concat(chunks).toString()));
        console.log(JSON.stringify({phase:'request',referenceCount:input.references.length,options:input.options}));
        const result=await generateCodexImage(input,controller.signal,async()=>({executablePath:'/opt/homebrew/bin/codex',env:process.env}));
        const images=[];
        for(const [index,item] of result.images.entries()){
            const file=`real-edit-${index+1}.png`;
            await writeFile(new URL(file,directory),Buffer.from(item.dataUrl.split(',')[1],'base64'));
            const {dataUrl,...metadata}=item;images.push({...metadata,file});
        }
        const {images:_,...metadata}=result;
        const report={...metadata,referenceCount:input.references.length,options:input.options,images,elapsedMs:Date.now()-started};
        await writeFile(new URL('real-ui-result.json',directory),JSON.stringify(report,null,2));
        console.log(JSON.stringify({phase:'completed',...report}));
        res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(result));
    }catch(error){
        const message=error instanceof Error?error.message:String(error);
        console.error(JSON.stringify({phase:'error',error:message}));
        res.writeHead(500,{'Content-Type':'application/json'}).end(JSON.stringify({error:message}));
    }
});
server.listen(17489,'127.0.0.1',()=>console.log('Real Codex verification server listening on 17489'));

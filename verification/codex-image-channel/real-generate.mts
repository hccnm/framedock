import { writeFile } from 'node:fs/promises';
import { generateCodexImage } from '../../canvas-agent/src/agent/codex-image.ts';
const directory = new URL('.', import.meta.url);
const started = Date.now();
try {
    const result = await generateCodexImage({projectId:'channel-verification',nodeId:'codex-image-config',requestId:'real-native-generation',prompt:'一只可爱的橙色纸雕小狐狸吉祥物，完整全身，居中，精致纸张层次，柔和立体光影，没有文字，没有底座。真实透明背景，不画棋盘格。',references:[],options:{size:'1536x1024',quality:'high',background:'transparent',count:2}},new AbortController().signal, async()=>({executablePath:'/opt/homebrew/bin/codex',env:process.env}));
    const images=[];
    for (const [index,item] of result.images.entries()) {
        const name=`real-native-${index+1}.png`;
        await writeFile(new URL(name,directory),Buffer.from(item.dataUrl.split(',')[1],'base64'));
        const {dataUrl,...metadata}=item; images.push({...metadata,file:name,bytes:Buffer.from(dataUrl.split(',')[1],'base64').length});
    }
    const {images:_,...metadata}=result;
    const report={...metadata,images,elapsedMs:Date.now()-started};
    await writeFile(new URL('real-result.json',directory),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
} catch(error) {
    const report={error:error instanceof Error?error.message:String(error),elapsedMs:Date.now()-started};
    await writeFile(new URL('real-result.json',directory),JSON.stringify(report,null,2));
    console.error(JSON.stringify(report)); process.exitCode=1;
}

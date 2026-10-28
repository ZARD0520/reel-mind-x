const { chromium, expect } = require('@playwright/test');
const { randomUUID } = require('node:crypto');
(async () => {
 const timeout=setTimeout(()=>{console.error('Browser settings test timed out');process.exit(1);},60000);
 const browser = await chromium.launch({ headless: true, channel: 'chrome' });
 try {
  const page = await browser.newPage({viewport:{width:1600,height:1100}});
  page.setDefaultTimeout(10000); console.log('Browser launched');
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  const id=randomUUID(); let submitted;
  let graph={version:1,viewport:{x:200,y:80,zoom:0.8},edges:[],nodes:[
   {id:'video',position:{x:0,y:0},data:{kind:'video',title:'Video',status:'idle',prompt:''}},
   {id:'image',position:{x:700,y:0},data:{kind:'image',title:'Image',status:'idle',prompt:''}}
  ]};
  await page.route('**/api/**',async route=>{
   const r=route.request(),path=new URL(r.url()).pathname;let json=[];
   if(path==='/api/auth/me')json={id:'user',name:'Test'};
   if(path===`/api/canvases/${id}`){if(r.method()==='PATCH')graph=r.postDataJSON().graph??graph;json={id,name:'Settings',graph};}
   if(path==='/api/generation-tasks'&&r.method()==='POST'){submitted=r.postDataJSON();json={id:randomUUID(),requestId:submitted.requestId,status:'generating',items:[]};}
   await route.fulfill({json});
  });
  await page.goto(`${process.env.E2E_BASE_URL??'http://localhost:5173'}/canvas/${id}`);
  const video=page.locator('.react-flow__node[data-id="video"]');
  console.log('Canvas loaded'); await video.click();
  await page.getByRole('button',{name:'选择视频生成设置'}).click();
  await expect(page.getByText('生成时长',{exact:true})).toHaveCount(0);
  await expect(page.getByText('支持 1 张 PNG/JPG/JPEG 参考图，最大 5MB')).toBeVisible();
  await page.getByRole('button',{name:'3840 × 2160',exact:true}).click();
  await page.getByRole('button',{name:'60 FPS',exact:true}).click();
  await page.getByRole('button',{name:'质量优先',exact:true}).click();
  await page.getByRole('button',{name:'选择视频生成设置'}).click();
  const input=page.getByRole('textbox',{name:'节点提示词'});
  await input.fill('test video');
  await expect.poll(()=>graph.nodes.find(n=>n.id==='video').data.videoFps).toBe(60);
  console.log('Settings saved'); await page.reload(); await video.click();
  await expect(page.getByRole('button',{name:'选择视频生成设置'})).toContainText('16:9 · 60 FPS');
  await expect(input).toHaveText('test video');
  console.log('Settings restored'); await input.fill('a'.repeat(513));
  await expect(input).toHaveText('test video');
  await input.fill('test video');
  await page.getByRole('button',{name:'生成视频',exact:true}).click();
  await expect.poll(()=>submitted?.fps).toBe(60);
  expect(submitted.size).toBe('3840x2160');expect(submitted.quality).toBe('quality');expect(submitted.duration).toBeUndefined();
  await page.locator('.react-flow__node[data-id="image"]').click();
  await page.getByRole('button',{name:'选择图片生成设置'}).click();
  await page.getByRole('button',{name:'864 × 1152',exact:true}).click();
  await page.getByRole('button',{name:'高清',exact:true}).click();
  await expect.poll(()=>graph.nodes.find(n=>n.id==='image').data.generationQuality).toBe('hd');
  expect(errors).toEqual([]);
  console.log('PASS: model settings, persistence, prompt length, resolution/fps/quality payload');
 } finally {clearTimeout(timeout); await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

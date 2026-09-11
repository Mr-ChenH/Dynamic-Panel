(function initSettingsLayout(){
  const page=document.getElementById('settings-page');
  if(!page)return;
  const groups=[
    {id:'general',title:'通用',description:'快捷键、启动与本地数据',selector:'.settings-device-card',icon:'M4 7h16 M4 17h16 M9 4v6 M15 14v6'},
    {id:'features',title:'显示功能',description:'选择工作区中的功能入口',selector:'.settings-features-card',icon:'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z'},
    {id:'home',title:'首页组件',description:'定制首页，至少保留一个组件',selector:'.settings-home-modules-card',icon:'m3 11 9-8 9 8 M6 9v12h12V9 M10 21v-7h4v7'},
    {id:'api',title:'AI 与转写',description:'管理智能命名和语音转写服务',selector:'.settings-api-card',icon:'m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z'},
  ];
  const aside=document.createElement('aside');aside.className='settings-sidebar';
  const heading=document.createElement('h2');heading.textContent='设置';aside.append(heading);
  const nav=document.createElement('div');nav.className='settings-navigation';nav.setAttribute('role','tablist');nav.setAttribute('aria-label','设置分类');aside.append(nav);
  const content=document.createElement('div');content.className='settings-content';content.setAttribute('aria-label','设置选项');
  const buttons=[],cards=[];
  for(const group of groups){
    const card=page.querySelector(group.selector);if(!card)return;
    card.id=`settings-pane-${group.id}`;card.setAttribute('role','tabpanel');card.setAttribute('aria-labelledby',`settings-category-${group.id}`);
    const button=document.createElement('button');button.type='button';button.id=`settings-category-${group.id}`;button.dataset.settingsCategory=group.id;button.setAttribute('role','tab');button.setAttribute('aria-controls',card.id);
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');
    const shape=document.createElementNS(svg.namespaceURI,'path');shape.setAttribute('d',group.icon);svg.append(shape);
    const label=document.createElement('span');label.textContent=group.title;button.append(svg,label);nav.append(button);
    const title=card.querySelector('.settings-card-heading strong');title.textContent=group.title;
    const eyebrow=card.querySelector('.tile-label');eyebrow.textContent=group.description;
    buttons.push(button);cards.push(card);content.append(card);
  }
  page.replaceChildren(aside,content);page.classList.add('settings-organized');
  function select(index,focus=false){
    buttons.forEach((button,i)=>{button.setAttribute('aria-selected',String(i===index));button.tabIndex=i===index?0:-1;cards[i].hidden=i!==index;});
    content.scrollTop=0;if(focus)buttons[index].focus();
  }
  buttons.forEach((button,index)=>button.addEventListener('click',()=>select(index)));
  nav.addEventListener('keydown',event=>{
    const index=buttons.indexOf(document.activeElement);if(index<0)return;
    const delta=['ArrowDown','ArrowRight'].includes(event.key)?1:['ArrowUp','ArrowLeft'].includes(event.key)?-1:0;
    if(delta||['Home','End'].includes(event.key)){event.preventDefault();select(event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+delta+buttons.length)%buttons.length,true);}
  });
  const narrow=matchMedia('(max-width:700px)');const orient=()=>nav.setAttribute('aria-orientation',narrow.matches?'horizontal':'vertical');narrow.addEventListener('change',orient);orient();select(0);
})();

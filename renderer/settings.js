(function initSettingsLayout(){
  const page=document.getElementById('settings-page');
  if(!page)return;
  const groups=[
    {id:'general',title:'通用',description:'快捷键、启动与本地数据',selector:'.settings-device-card',icon:'M4 7h16 M4 17h16 M9 4v6 M15 14v6'},
    {id:'music',title:'音乐',description:'本地与网络播放源',selector:'.settings-music-card',icon:'M9 18V5l10-2v13 M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6 M16 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6'},
    {id:'launcher',title:'搜索与启动器',description:'搜索来源、快捷键与本地扩展',selector:'.settings-launcher-card',icon:'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14 M15 15l6 6'},
    {id:'features',title:'显示功能',description:'选择工作区中的功能入口',selector:'.settings-features-card',icon:'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z'},
    {id:'api',title:'AI 与转写',description:'管理智能命名和语音转写服务',selector:'.settings-api-card',icon:'m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z'},
  ];
  const retiredHomeCard=page.querySelector('.settings-home-modules-card');
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
  page.replaceChildren(aside,content);
  if(retiredHomeCard){retiredHomeCard.hidden=true;retiredHomeCard.inert=true;retiredHomeCard.setAttribute('aria-hidden','true');page.append(retiredHomeCard);}
  page.classList.add('settings-organized');
  function select(index,focus=false){
    buttons.forEach((button,i)=>{button.setAttribute('aria-selected',String(i===index));button.tabIndex=i===index?0:-1;cards[i].hidden=i!==index;});
    content.scrollTop=0;if(focus)buttons[index].focus();
    const selectedId=groups[index].id;
    if(selectedId==='launcher')window.NotchLauncher?.renderSettings();
    else window.NotchLauncher?.hideSettings();
    window.dispatchEvent(new CustomEvent('notch:settings-category-change',{detail:{id:selectedId}}));
  }
  buttons.forEach((button,index)=>button.addEventListener('click',()=>select(index)));
  nav.addEventListener('keydown',event=>{
    const index=buttons.indexOf(document.activeElement);if(index<0)return;
    const delta=['ArrowDown','ArrowRight'].includes(event.key)?1:['ArrowUp','ArrowLeft'].includes(event.key)?-1:0;
    if(delta||['Home','End'].includes(event.key)){event.preventDefault();select(event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+delta+buttons.length)%buttons.length,true);}
  });
  window.NotchSettings={select:id=>{const index=groups.findIndex(group=>group.id===id);if(index>=0)select(index);}};
  const narrow=matchMedia('(max-width:700px)');const orient=()=>nav.setAttribute('aria-orientation',narrow.matches?'horizontal':'vertical');narrow.addEventListener('change',orient);orient();select(0);
})();

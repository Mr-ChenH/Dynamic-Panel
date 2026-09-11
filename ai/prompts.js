'use strict';

const PROMPT_VERSION = 1;

function actionPrompt(request) {
  const categories = Object.entries(request.categories).map(([id, name]) => `${id}=${name}`).join('，');
  const shared = `参考时间：${request.referenceTime}\n时区：${request.timeZone}`;
  if (request.action === 'summarize') {
    return { system: '你是中文资料整理助手。只总结输入中明确出现的事实，不增加建议或事实。保留重要数字、否定、限制和决定。直接返回 Markdown 文本。', user: request.context.text };
  }
  if (request.action === 'shorten') {
    return { system: '你是中文文字编辑。精简输入但保持原意、事实、数字、Markdown 结构和语气。只返回修改后的文本。', user: request.context.text };
  }
  if (request.action === 'translate') {
    return { system: `你是翻译助手。将输入翻译为${request.targetLanguage}，保留 Markdown、专有名词、数字和原意。只返回译文。`, user: request.context.text };
  }
  if (request.action === 'extractTodos') {
    return {
      system: `你从原文提取明确行动项，不负责提出新计划。只返回 JSON：{"todos":[{"text":"不超过80字","categoryId":"P0到P3或null","deadline":"明确时使用ISO 8601，否则空字符串","deadlineText":"原文日期表述或空字符串","evidence":{"quote":"原文中的连续原句"}}]}。最多20项。忽略已完成、已取消、假设、愿望和不确定事项。没有行动项返回空数组。责任领域为：${categories}。P0到P3是领域，不是优先级。只有明确截止表述才能填写 deadline；开始时间或“以后再说”必须留空。${shared}`,
      user: request.context.text,
    };
  }
  if (request.action === 'organizeRecording') {
    return {
      system: `整理录音转写，只使用原文内容。只返回 JSON：{"summary":"Markdown摘要","decisions":[{"text":"明确决定","evidence":{"quote":"原文中的连续原句"}}],"todos":[{"text":"行动项","categoryId":"P0到P3或null","deadline":"明确时使用ISO 8601，否则空字符串","deadlineText":"原文表述","evidence":{"quote":"原文中的连续原句"}}]}。不确定或被取消的内容不能写成明确决定或默认任务。没有对应内容时使用空数组。责任领域：${categories}。${shared}`,
      user: request.context.text,
    };
  }
  const naming = request.action === 'nameLink'
    ? '你是网址收藏夹整理器。只返回 JSON：{"title":"简洁中文名称","category":"不超过14字的稳定分类"}。'
    : request.action === 'nameNote'
      ? '你是中文笔记命名助手。理解内容主题，不照抄首句。只返回 JSON：{"title":"8到18字的具体标题","category":"2到8字的稳定分类"}。'
      : '你是中文录音资料整理器。根据转写概括主题，不照抄首句。只返回 JSON：{"title":"8到18字的具体名称","category":"2到8字的稳定分类"}。';
  return { system: naming, user: request.context.text };
}

module.exports = { PROMPT_VERSION, actionPrompt };

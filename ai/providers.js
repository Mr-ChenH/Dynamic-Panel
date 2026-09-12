'use strict';

const PROVIDERS = Object.freeze({
  deepseek: {
    id: 'deepseek', label: 'DeepSeek', adapterId: 'openai-chat',
    defaultBaseUrl: 'https://api.deepseek.com', defaultModel: 'deepseek-flash',
    keyUrl: 'https://platform.deepseek.com/api_keys', requireDoneMarker: true,
  },
  openai: {
    id: 'openai', label: 'OpenAI', adapterId: 'openai-chat',
    defaultBaseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4.1-mini',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  bailian: {
    id: 'bailian', label: '阿里云百炼', adapterId: 'openai-chat',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen-plus',
    keyUrl: 'https://bailian.console.aliyun.com/cn-beijing/?tab=app#/api-key', endpointEditable: true,
  },
  kimi: {
    id: 'kimi', label: 'Kimi', adapterId: 'openai-chat',
    defaultBaseUrl: 'https://api.moonshot.cn/v1', defaultModel: 'kimi-k3',
    keyUrl: 'https://platform.kimi.com/console/api-keys', requireDoneMarker: true,
  },
  zhipu: {
    id: 'zhipu', label: '智谱 GLM', adapterId: 'openai-chat',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4', defaultModel: 'glm-5.3',
    keyUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
  },
  siliconflow: {
    id: 'siliconflow', label: 'SiliconFlow', adapterId: 'openai-chat',
    defaultBaseUrl: 'https://api.siliconflow.cn/v1', defaultModel: 'Qwen/Qwen3-32B',
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
  },
  gemini: {
    id: 'gemini', label: 'Google Gemini', adapterId: 'openai-chat',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', defaultModel: 'gemini-2.5-flash',
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  openrouter: {
    id: 'openrouter', label: 'OpenRouter', adapterId: 'openai-chat',
    defaultBaseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'openai/gpt-4o-mini',
    keyUrl: 'https://openrouter.ai/settings/keys',
  },
  azure: {
    id: 'azure', label: 'Azure OpenAI', adapterId: 'openai-chat',
    defaultBaseUrl: '', defaultModel: '', keyUrl: 'https://portal.azure.com/', endpointEditable: true,
    endpointPlaceholder: 'https://资源名.openai.azure.com/openai/v1', modelPlaceholder: '部署名称',
  },
  anthropic: {
    id: 'anthropic', label: 'Anthropic Claude', adapterId: 'anthropic-messages',
    defaultBaseUrl: 'https://api.anthropic.com', defaultModel: 'claude-sonnet-4-5',
    keyUrl: 'https://platform.claude.com/settings/keys',
  },
  'custom-openai': {
    id: 'custom-openai', label: '自定义 OpenAI-compatible', adapterId: 'openai-chat',
    defaultBaseUrl: '', defaultModel: '', keyUrl: '', endpointEditable: true,
    endpointPlaceholder: 'https://服务地址/v1', modelPlaceholder: '模型名称',
  },
});

const PROVIDER_HOSTS = Object.freeze({
  'api.deepseek.com': 'deepseek',
  'api.openai.com': 'openai',
  'dashscope.aliyuncs.com': 'bailian',
  'dashscope-intl.aliyuncs.com': 'bailian',
  'api.moonshot.cn': 'kimi',
  'open.bigmodel.cn': 'zhipu',
  'api.siliconflow.cn': 'siliconflow',
  'generativelanguage.googleapis.com': 'gemini',
  'openrouter.ai': 'openrouter',
  'api.anthropic.com': 'anthropic',
});

function providerFor(value) {
  return PROVIDERS[String(value || '')] || PROVIDERS['custom-openai'];
}

function inferProviderId(baseUrl) {
  try {
    const hostname = new URL(String(baseUrl || '')).hostname.toLowerCase();
    if (hostname.endsWith('.openai.azure.com')) return 'azure';
    if (hostname.endsWith('.maas.aliyuncs.com')) return 'bailian';
    return PROVIDER_HOSTS[hostname] || 'custom-openai';
  } catch (error) {
    return 'custom-openai';
  }
}

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function normalizeProviderId(value, baseUrl) {
  const id = String(value || '').trim();
  if (PROVIDERS[id]) return id;
  return String(baseUrl || '').trim() ? inferProviderId(baseUrl) : 'deepseek';
}

function normalizeModelName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function normalizeModelList(values, fallback = '') {
  const source = Array.isArray(values) ? values : [];
  const unique = [];
  for (const value of [...source, fallback]) {
    const model = normalizeModelName(value);
    if (model && !unique.includes(model)) unique.push(model);
    if (unique.length >= 12) break;
  }
  return unique;
}

function normalizeContentProfile(providerId, value = {}, fallback = {}) {
  const provider = providerFor(providerId);
  const modelFallback = value.activeModel || value.model || fallback.model || provider.defaultModel;
  const models = normalizeModelList(value.models, modelFallback);
  const activeModelCandidate = normalizeModelName(value.activeModel || value.model || fallback.model);
  const activeModel = models.includes(activeModelCandidate) ? activeModelCandidate : models[0] || '';
  return {
    providerId,
    adapterId: provider.adapterId,
    baseUrl: normalizeBaseUrl(value.baseUrl || fallback.baseUrl || provider.defaultBaseUrl),
    models,
    activeModel,
    timeoutMs: Math.max(10000, Math.min(60000, Number(value.timeoutMs || fallback.timeoutMs) || 30000)),
  };
}

function normalizeContentProfiles(settings = {}) {
  const stored = settings?.services?.content && typeof settings.services.content === 'object'
    ? settings.services.content : {};
  const rawProfiles = stored.profiles && typeof stored.profiles === 'object' && !Array.isArray(stored.profiles)
    ? stored.profiles : {};
  const legacyBaseUrl = String(settings.llmBaseUrl || '').trim();
  const legacyProviderId = normalizeProviderId(stored.providerId || settings.llmProviderId, stored.baseUrl || legacyBaseUrl);
  let activeProviderId = normalizeProviderId(stored.activeProviderId || legacyProviderId, stored.baseUrl || legacyBaseUrl);
  const profiles = {};
  for (const [providerId, value] of Object.entries(rawProfiles)) {
    if (!PROVIDERS[providerId] || !value || typeof value !== 'object' || Array.isArray(value)) continue;
    profiles[providerId] = normalizeContentProfile(providerId, value);
  }
  if (!profiles[legacyProviderId]) {
    profiles[legacyProviderId] = normalizeContentProfile(legacyProviderId, stored, {
      baseUrl: legacyBaseUrl,
      model: settings.llmModel,
      timeoutMs: settings.llmTimeoutMs,
    });
  }
  if (!profiles[activeProviderId]) activeProviderId = profiles[legacyProviderId] ? legacyProviderId : Object.keys(profiles)[0] || 'deepseek';
  if (!profiles[activeProviderId]) profiles[activeProviderId] = normalizeContentProfile(activeProviderId);
  return { activeProviderId, profiles };
}

function normalizeContentService(settings = {}) {
  const content = normalizeContentProfiles(settings);
  const profile = content.profiles[content.activeProviderId] || normalizeContentProfile(content.activeProviderId);
  return {
    providerId: profile.providerId,
    adapterId: profile.adapterId,
    baseUrl: profile.baseUrl,
    model: profile.activeModel,
    timeoutMs: profile.timeoutMs,
  };
}

function normalizeTranscriptionService(settings = {}, model = 'qwen3-asr-flash-realtime') {
  const stored = settings?.services?.transcription && typeof settings.services.transcription === 'object'
    ? settings.services.transcription : {};
  const region = ['beijing', 'singapore'].includes(stored.region)
    ? stored.region : ['beijing', 'singapore'].includes(settings.region) ? settings.region : 'beijing';
  return {
    providerId: 'aliyun-bailian-realtime',
    model: String(stored.model || model),
    region,
    workspaceId: String(stored.workspaceId || settings.workspaceId || '').trim().slice(0, 128),
  };
}

function publicContentProviders() {
  return Object.values(PROVIDERS).map((provider) => ({
    id: provider.id,
    label: provider.label,
    adapterId: provider.adapterId,
    defaultBaseUrl: provider.defaultBaseUrl,
    defaultModel: provider.defaultModel,
    keyUrl: provider.keyUrl,
    endpointEditable: provider.endpointEditable === true,
    endpointPlaceholder: provider.endpointPlaceholder || 'https://服务地址/v1',
    modelPlaceholder: provider.modelPlaceholder || provider.defaultModel || '模型名称',
  }));
}

function contentConfigRevision(service) {
  const value = service || {};
  return [value.providerId, normalizeBaseUrl(value.baseUrl), value.model, value.timeoutMs].join('|');
}

module.exports = {
  PROVIDERS,
  providerFor,
  inferProviderId,
  normalizeBaseUrl,
  normalizeProviderId,
  normalizeModelName,
  normalizeModelList,
  normalizeContentProfile,
  normalizeContentProfiles,
  normalizeContentService,
  normalizeTranscriptionService,
  publicContentProviders,
  contentConfigRevision,
};

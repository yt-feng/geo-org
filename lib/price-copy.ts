const phrases: Record<string, string> = {
  '当前开放已核定参数的新生成请求；专用编辑和扩展接口、外部视频或音频输入及动作迁移暂未开放，参考图仅支持已核定的参数组合。': 'New generation requests support the validated parameters. Dedicated editing, extension, external video/audio input and motion transfer are not available; reference images require supported parameter combinations.',
  '当前开放 generate 基础音乐生成；其他版本、续写、转换及其他操作的价格仅供查阅，暂未开放调用。': 'Basic generate requests are supported. Prices for other versions, continuation, conversion and other operations are listed for reference; these operations are not available.',
  '当前开放 v6、v6-wild、v6-mini 的基础音乐生成；旧版本、续写、转换及其他操作的价格仅供查阅，暂未开放调用。': 'Basic generation supports v6, v6-wild and v6-mini. Older versions, continuation, conversion and other operations are listed for reference only.',
  '当前开放纯文本对话；多模态输入、工具调用和显式缓存创建暂未开放。': 'Plain text chat is supported. Multimodal input, tool calls and explicit cache creation are not available.',
  '下列工具与缓存存储价格供查阅，不代表这些附加功能已开放。': 'Tool and cache storage prices below are for reference; listing a price does not mean the feature is available.',
  '价格已列示，服务待开通。': 'Pricing listed; service activation pending.',
  '长上下文使用对应档位费率。': 'Long context uses the corresponding pricing tier.',
  '支持纯文本完整响应；按实际用量结算。': 'Non-streaming text responses, billed on actual usage.',
  '每次生成一张 1024x1024 图像。': 'One 1024 × 1024 image per request.',
  '按此缓存时长计费，与按小时价格为同一费用的不同表示': 'Billed for this cache duration; equivalent to the hourly rate, not an additional charge.',
  '生成预留参考；最终按下列 token 单价结算': 'Generation reservation estimate; final billing uses the token rates below.',
};
const words: Array<[string, string]> = [
  ['tokvilo 模型服务', 'tokvilo Models'], ['tokvilo 多模态', 'tokvilo Multimodal'], ['tokvilo 精选', 'tokvilo Select'],
  ['缓存文本输入','Cached text input'],['缓存图像输入','Cached image input'],['显式缓存输入','Explicit cached input'],['显式缓存存储','Explicit cache storage'],['缓存存储','Cache storage'],['缓存读取','Cache read'],['缓存写入','Cache write'],['缓存输入','Cached input'],['文本输入','Text input'],['文本输出','Text output'],['图像输入','Image input'],['图像输出','Image output'],['图像生成','Image generation'],['参考图片','Reference image'],['参考视频','Reference video'],['参考素材另计','Reference media billed separately'],['前 5 项免费','First 5 items free'],['前 2 项免费','First 2 items free'],['最多计 15 秒','Up to 15 seconds billed'],['仅创建显式缓存时计费','Charged only when creating an explicit cache'],['启用搜索工具时另计','Additional charge when using search'],['启用此工具时另计','Additional charge when using this tool'],['最终结算','Final billing'],['每次请求','Per request'],['Google 网页搜索','Google web search'],['网页图片搜索','Web image search'],['图片搜索','Image search'],['网页提取','Web extraction'],['网页搜索','Web search'],['代码执行','Code execution'],['高峰（UTC，00:00-14:00）','Peak (00:00–14:00 UTC)'],['低峰（UTC，其余时段）','Off-peak (other UTC hours)'],['输入不超过','Input up to'],['输入超过','Input above'],['无更高分档','no higher tier'],['输入','Input'],['输出','Output'],['默认','Default'],['分钟','minutes'],['小时','hour'],['生成','Generation'],
];
export function englishPriceText(value: string): string {
  if (phrases[value]) return phrases[value];
  return words.reduce((text, [zh, en]) => text.replaceAll(zh, en), value)
    .replace(/，no higher tier tokens/g, ' tokens (no higher tier)')
    .replace(/([0-9])(minutes|hour)/g, '$1 $2')
    .replaceAll('（', ' (').replaceAll('）', ')').replaceAll('，', ', ');
}

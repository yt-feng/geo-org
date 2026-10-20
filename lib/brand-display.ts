/** Service labels and operational notices only; never apply to model IDs or generated content. */
export function displayServiceText(value: string): string {
  return value
    .replace(/(?:tianshu[\s-]*)?(?:ai[\s-]*)?token[\s-]*hub(?:\.ai)?/gi, "tokvilo 多模态")
    .replace(/api[\s-]*mart(?:\.ai)?/gi, "tokvilo 文本与图像")
    .replace(/tik[\s-]*hub(?:\.io)?/gi, "tokvilo 数据接口")
    .replace(/eco[\s-]*geo/gi, "tokvilo");
}

export function serviceLabel(provider: string): string {
  return provider === "tokenhub" ? "tokvilo 多模态"
    : provider === "apimart" ? "tokvilo 文本与图像"
      : provider === "tikhub" ? "tokvilo 数据接口" : displayServiceText(provider);
}

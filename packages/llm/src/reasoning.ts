/** Some upstream models place internal reasoning in content instead of reasoning_content. */
export function finalAnswerText(text: string): string {
  const withoutBlocks = text.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '');
  // The opening tag may have been omitted by the provider.
  const closing = withoutBlocks.toLowerCase().lastIndexOf('</think>');
  const answer = closing >= 0 ? withoutBlocks.slice(closing + '</think>'.length) : withoutBlocks;
  return answer.replace(/<think\b[^>]*>[\s\S]*$/gi, '').trim();
}

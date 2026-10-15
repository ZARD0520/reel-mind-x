type MarkdownNode = {
  type: string;
  value?: string;
  children?: MarkdownNode[];
};

export function rehypeChatCaret() {
  return (tree: MarkdownNode) => {
    let lastText: { parent: MarkdownNode; index: number } | undefined;

    function findLastText(parent: MarkdownNode) {
      parent.children?.forEach((child, index) => {
        if (child.type === 'text' && child.value?.trim()) {
          lastText = { parent, index };
        }
        findLastText(child);
      });
    }

    findLastText(tree);

    const caret = {
      type: 'element',
      tagName: 'span',
      properties: { className: ['canvas-chat-caret'], ariaHidden: 'true' },
      children: [],
    };

    if (lastText) {
      lastText.parent.children?.splice(lastText.index + 1, 0, caret);
    } else {
      tree.children?.push(caret);
    }
  };
}

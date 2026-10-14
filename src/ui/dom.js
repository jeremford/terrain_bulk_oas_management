/**
 * The one DOM helper shared by the ui modules. Lives in its own module because
 * the single-file build concatenates every module into one scope: two modules
 * each declaring their own `el` is a SyntaxError in the built file while the
 * dev server keeps working, which is exactly how it broke once.
 */

export const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

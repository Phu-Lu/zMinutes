import { Editor, Node, mergeAttributes } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Markdown } from "@tiptap/markdown";

const MeetingImage = Node.create({
  name: "meetingImage",
  group: "inline",
  inline: true,
  atom: true,
  draggable: true,
  addAttributes() { return { photoId: { default: "" } }; },
  parseHTML() { return [{ tag: "img[data-photo-id]", getAttrs: (el) => ({ photoId: el.getAttribute("data-photo-id") }) }]; },
  renderHTML({ HTMLAttributes }) { return ["img", { "data-photo-id": HTMLAttributes.photoId, class: "note-inline-photo", alt: "Meeting photo" }]; },
  addNodeView() {
    return ({ node }) => {
      const img = document.createElement("img");
      img.className = "note-inline-photo";
      img.alt = "Meeting photo";
      img.dataset.photoId = node.attrs.photoId;
      const photo = this.options.resolvePhoto?.(node.attrs.photoId) || window.ZM?.current()?.photos.find((item) => item.id === node.attrs.photoId);
      if (photo?.mediaId)
        window.ZMinutesStore.mediaURL(photo.mediaId).then((url) => { if (url) img.src = url; });
      else img.alt = "Photo unavailable";
      return { dom: img };
    };
  },
});
const NoteCallout = Node.create({
  name: "noteCallout",
  group: "block",
  content: "inline*",
  addAttributes() { return { kind: { default: "important" } }; },
  parseHTML() { return [{ tag: "p[data-note-kind]", getAttrs: (el) => ({ kind: el.getAttribute("data-note-kind") }) }]; },
  renderHTML({ node, HTMLAttributes }) { return ["p", mergeAttributes(HTMLAttributes, { "data-note-kind": node.attrs.kind, class: "note-callout" }), 0]; },
});
const SourceBlock = Node.create({
  name: "sourceBlock",
  group: "block",
  content: "paragraph+",
  addAttributes() { return { source: { default: "transcript" }, language: { default: "" } }; },
  parseHTML() { return [{ tag: "div[data-note-source]", getAttrs: (el) => ({ source: el.getAttribute("data-note-source"), language: el.getAttribute("data-note-language") || "" }) }]; },
  renderHTML({ node }) { return ["div", { "data-note-source": node.attrs.source, "data-note-language": node.attrs.language, class: "note-source-block" }, 0]; },
});
const extensions = [StarterKit.configure({ link: false }), Underline, Markdown, MeetingImage, NoteCallout, SourceBlock];
const empty = () => ({ type: "doc", content: [{ type: "paragraph" }] });
function plainDocument(text) {
  return { type: "doc", content: String(text).split(/\r?\n/).map((line) => ({ type: "paragraph", ...(line ? { content: [{ type: "text", text: line }] } : {}) })) };
}
function legacyDocument(markdown) {
  if (!markdown) return { doc: empty(), warning: "" };
  // Keep uncommon Markdown literal until it can be reviewed in the editor.
  const unsupported = /!\[[^\]]*\]\(|\[[^\]]+\]\([^)]+\)|<[^>]+>|(^|\n)\s*(?:```|~~~|\|)/.test(markdown);
  if (unsupported) return { doc: plainDocument(markdown), warning: "Some Markdown syntax was kept as literal text; the original is saved in Recovery." };
  try {
    const probe = new Editor({ extensions, content: empty(), editable: false });
    const prepared = markdown.replace(/\n(?=\s*(?:[◇✓!]\s*)?(?:DECISION|ACTION ITEM|IMPORTANT)\s*:)/gi, "\n\n");
    const doc = probe.storage.markdown.manager.parse(prepared);
    probe.destroy();
    if (!doc?.content?.length) throw new Error("Empty parse");
    for (const block of doc.content) {
      const source = (block.content || []).map((item) => item.text || "").join("");
      const match = source.match(/^\s*(?:[◇✓!]\s*)?(DECISION|ACTION ITEM|IMPORTANT)\s*:\s*(.*)$/i);
      if (match && block.type === "paragraph") {
        block.type = "noteCallout";
        block.attrs = { kind: match[1].toLowerCase() === "action item" ? "task" : match[1].toLowerCase() };
        block.content = match[2] ? [{ type: "text", text: match[2] }] : [];
      }
    }
    return { doc, warning: "" };
  } catch {
    return { doc: plainDocument(markdown), warning: "Markdown was kept as literal text; the original is saved in Recovery." };
  }
}
function create(host, onUpdate, options = {}) {
  return new Editor({
    element: host,
    extensions: options.personal ? [StarterKit.configure({link:false}), Underline, TaskList, TaskItem.configure({nested:true}), MeetingImage.configure({resolvePhoto: options.resolvePhoto})] : extensions,
    content: empty(),
    editable: false,
    editorProps: { attributes: { class: "note-wysiwyg", role: "textbox", "aria-label": options.personal ? "Personal note" : "Meeting Notes", "aria-multiline": "true" } },
    onUpdate: () => onUpdate(),
  });
}
window.ZMinutesTiptap = { create, empty, legacyDocument, plainDocument };

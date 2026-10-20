/* Self-contained DOCX: rich text and embedded PNG images, never audio. */
(() => {
  const x = ZM.esc;
  ZM.personalWord = async (note) => {
    const files = {},
      relationships = [],
      pictures = new Map();
    let imageId = 0;
    const referenced = ZMinutesModel.notePhotoIds(note.noteDoc);
    for (const photo of note.photos.filter((p) => referenced.has(p.id))) {
      const media = await ZMinutesStore.get("media", photo.mediaId);
      if (!media)
        throw new Error(
          "A note picture is unavailable. Restore it before exporting.",
        );
      const image = new Image(),
        url = URL.createObjectURL(media.blob);
      image.src = url;
      try {
        await image.decode();
        const canvas = document.createElement("canvas");
        const ratio = Math.min(1, 1600 / image.naturalWidth);
        canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
        canvas
          .getContext("2d")
          .drawImage(image, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise((resolve) =>
          canvas.toBlob(resolve, "image/png"),
        );
        if (!blob) throw new Error("Could not export picture.");
        const id = ++imageId,
          name = `image${id}.png`,
          width = Math.min(540, canvas.width),
          height = (canvas.height * width) / canvas.width;
        files["word/media/" + name] = new Uint8Array(await blob.arrayBuffer());
        relationships.push(
          `<Relationship Id="img${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/>`,
        );
        const cx = Math.round(width * 9525),
          cy = Math.round(height * 9525);
        pictures.set(
          photo.id,
          `<w:r><w:drawing><wp:inline><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Picture ${id}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="img${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`,
        );
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    const text = (value, marks = []) =>
      `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/>${marks.map((m) => ({ bold: "<w:b/>", italic: "<w:i/>", underline: '<w:u w:val="single"/>', strike: "<w:strike/>" })[m.type] || "").join("")}</w:rPr><w:t xml:space="preserve">${x(value)}</w:t></w:r>`;
    const inline = (n) =>
      n.type === "text"
        ? text(n.text, n.marks)
        : n.type === "hardBreak"
          ? "<w:r><w:br/></w:r>"
          : n.type === "meetingImage"
            ? pictures.get(n.attrs.photoId) || ""
            : (n.content || []).map(inline).join("");
    const paragraph = (n, prefix = "") =>
      `<w:p><w:pPr><w:spacing w:after="140"/></w:pPr>${text(prefix)}${inline(n)}</w:p>`;
    function blocks(n, prefix = "") {
      if (["paragraph", "heading"].includes(n.type))
        return paragraph(n, prefix);
      if (["bulletList", "orderedList", "taskList"].includes(n.type))
        return (n.content || [])
          .map((item, i) =>
            blocks(
              item,
              n.type === "orderedList"
                ? `${i + 1}. `
                : n.type === "taskList"
                  ? item.attrs?.checked
                    ? "☑ "
                    : "☐ "
                  : "• ",
            ),
          )
          .join("");
      return (n.content || [])
        .map((child, i) => blocks(child, i === 0 ? prefix : ""))
        .join("");
    }
    files["[Content_Types].xml"] =
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
    files["_rels/.rels"] =
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
    files["word/_rels/document.xml.rels"] =
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      relationships.join("") +
      "</Relationships>";
    files["word/document.xml"] =
      '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body><w:p>' +
      text(note.title || "Untitled note", [{ type: "bold" }]) +
      "</w:p>" +
      blocks(note.noteDoc) +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1020" w:right="1020" w:bottom="1020" w:left="1020"/></w:sectPr></w:body></w:document>';
    ZM.download(
      ZM.exports.zip(files),
      (note.title || "Untitled note").replace(/[\\/:*?"<>|]/g, "-") + ".docx",
    );
  };
})();

import { useEffect, useRef, useState } from "react";

export const ALLOWED_EVIDENCE_MIME = ["application/pdf", "image/jpeg", "image/png"] as const;
export type EvidenceMime = (typeof ALLOWED_EVIDENCE_MIME)[number];

export function isAllowedEvidenceMime(value: string): value is EvidenceMime {
  return (ALLOWED_EVIDENCE_MIME as readonly string[]).includes(value.toLowerCase());
}

export function EvidencePreview({ load, expectedMime, onLoaded }: { load: () => Promise<Blob>; expectedMime: string; onLoaded: () => void }) {
  const [url, setUrl] = useState("");
  const [mime, setMime] = useState<EvidenceMime | "">("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const urlRef = useRef("");

  function close() {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = "";
    setUrl("");
    setMime("");
  }

  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  async function open() {
    setLoading(true);
    setError("");
    close();
    try {
      const blob = await load();
      const responseMime = blob.type.toLowerCase();
      if (!isAllowedEvidenceMime(responseMime) || responseMime !== expectedMime.toLowerCase())
        throw new Error("Định dạng hồ sơ trả về không hợp lệ hoặc không khớp metadata.");
      const nextUrl = URL.createObjectURL(blob);
      urlRef.current = nextUrl;
      setMime(responseMime);
      setUrl(nextUrl);
      onLoaded();
    } catch (reason) {
      setError((reason as Error).message || "Không thể tải hồ sơ. Vui lòng thử lại.");
    } finally {
      setLoading(false);
    }
  }

  return <div className="evidence-preview">
    {!url && <button type="button" className="secondary" disabled={loading} onClick={() => void open()}>{loading ? "Đang tải hồ sơ…" : "Mở hồ sơ"}</button>}
    {error && <p role="alert" className="feedback error">{error}</p>}
    {url && <>
      <div className="evidence-frame">
        {mime === "application/pdf"
          ? <object data={url} type="application/pdf" aria-label="Nội dung hồ sơ PDF"><p>Trình duyệt không hỗ trợ xem PDF trong trang.</p></object>
          : <img src={url} alt="Nội dung hồ sơ đối chiếu" />}
      </div>
      <div className="actions">
        {mime === "application/pdf" && <a className="button secondary" href={url} target="_blank" rel="noopener noreferrer">Mở trong tab mới</a>}
        <button type="button" className="secondary" onClick={close}>Đóng hồ sơ</button>
      </div>
    </>}
  </div>;
}

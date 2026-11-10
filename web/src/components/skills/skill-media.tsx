import { useEffect, useRef, useState } from "react";
import { FileVideo, RotateCw } from "lucide-react";

export function SkillMedia({ src, title, preview = false }: { src: string; title: string; preview?: boolean }) {
    const ref = useRef<HTMLDivElement>(null);
    const video = useRef<HTMLVideoElement>(null);
    const [visible, setVisible] = useState(!preview);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        if (!preview || !ref.current) return;
        const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
        observer.observe(ref.current);
        return () => observer.disconnect();
    }, [preview]);
    useEffect(() => {
        if (visible && preview && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) void video.current?.play().catch(() => undefined);
        else video.current?.pause();
    }, [visible, preview, failed]);
    const isVideo = /\.(mp4|webm|mov|m4v)(?:[?#]|$)/i.test(src);
    return <div ref={ref} className="skill-media">
        {failed ? <div className="skill-media-error"><FileVideo size={24} /><span>素材加载失败</span><button onClick={(event) => { event.stopPropagation(); setFailed(false); }}><RotateCw size={14} />重试</button></div> : visible && (isVideo
            ? <video ref={video} src={src} aria-label={title} controls={!preview} muted={preview} loop={preview} playsInline preload="metadata" onError={() => setFailed(true)} />
            : <img src={src} alt={title} loading="lazy" onError={() => setFailed(true)} />)}
    </div>;
}

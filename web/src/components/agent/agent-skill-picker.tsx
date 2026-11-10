import { useState } from "react";
import { Button, Input, Popover } from "antd";
import { Check, Puzzle, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAgentSkillStore } from "@/stores/use-agent-skill-store";

export function AgentSkillPicker({ disabled }: { disabled?: boolean }) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const skills = useAgentSkillStore((state) => state.skills);
    const selected = useAgentSkillStore((state) => state.selectedSkill);
    const navigate = useNavigate();
    const items = skills.filter((skill) => skill.enabled && `${skill.name} ${skill.interface?.displayName || ""} ${skill.description}`.toLowerCase().includes(query.trim().toLowerCase()));
    return <Popover trigger="click" placement="topLeft" open={open} onOpenChange={setOpen} content={<div className="agent-skill-picker">
        <Input autoFocus prefix={<Search size={14} />} placeholder="搜索技能" aria-label="搜索可用技能" value={query} onChange={(event) => setQuery(event.target.value)} allowClear />
        <div className="agent-skill-options">{items.map((skill) => <button key={skill.path} onClick={() => { useAgentSkillStore.getState().selectSkill(skill); setOpen(false); }}><Puzzle size={15} /><span><strong>{skill.interface?.displayName || skill.name}</strong><small>{skill.description}</small></span>{selected?.path === skill.path && <Check size={14} />}</button>)}{!items.length && <p>暂无可用技能</p>}</div>
        <footer>{selected && <Button type="text" size="small" onClick={() => { useAgentSkillStore.getState().clearSelection(); setOpen(false); }}>取消选择</Button>}<Button type="text" size="small" onClick={() => { setOpen(false); navigate("/skills"); }}>浏览全部技能</Button></footer>
    </div>}><Button type="text" disabled={disabled} aria-label="选择技能" className="agent-skill-button" icon={<Puzzle size={15} />}>{selected?.interface?.displayName || "技能"}</Button></Popover>;
}

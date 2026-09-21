import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { TimelineMessage } from "@sudoku/domain";
import { ConversationDraftProvider, useConversationDraft } from "../../../features/messenger/conversation-drafts";
import { MessageInteraction } from "../../../features/messenger/message-interaction";
import { MessageActionSheet } from "../../../features/messenger/message-action-sheet";
import { MessageMeta } from "../../../features/messenger/message-meta";
import { MessageTimeline, type MessageTimelineHandle } from "../../../features/messenger/message-timeline";

const CURRENT_USER = "me";
type FixtureMessage = TimelineMessage & { body: string };
const initial = Array.from({ length: 140 }, (_, index): FixtureMessage => ({
  id: `m${index + 1}`, sequence: index + 1, senderId: index % 5 === 0 ? "me" : "peer",
  body: `Message ${index + 1}`, createdAt: new Date(Date.UTC(2026, 8, 21, 10, index)).toISOString(),
}));
declare global {
  interface Window {
    __uxFixture: {
      append: (own?: boolean) => void;
      prepend: () => void;
      resizeAbove: () => void;
      jump: (sequence: number) => void;
      reads: number[];
    };
  }
}

function Chat({ id }: { id: string }) {
  const [draft, setDraft] = useConversationDraft(id);
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState("");
  const [reply, setReply] = useState("");
  const [action, setAction] = useState<FixtureMessage | null>(null);
  const [messages, setMessages] = useState(initial);
  const [visibleCount, setVisibleCount] = useState(120);
  const [notice, setNotice] = useState("");
  const composer = useRef<HTMLTextAreaElement>(null);
  const timeline = useRef<MessageTimelineHandle>(null);
  const reads = useRef<number[]>([]);
  useEffect(() => {
    window.__uxFixture = {
      append(own = false) {
        setMessages((current) => {
          const last = current.at(-1)!.sequence;
          return [...current, { id: `m${last + 5}`, sequence: last + 5, senderId: own ? "me" : "peer", body: `Message ${last + 5}`, createdAt: new Date(Date.UTC(2026, 8, 21, 15, last)).toISOString() }];
        });
      },
      prepend: () => setVisibleCount((value) => value + 120),
      resizeAbove: () => { const node = document.querySelector<HTMLElement>(".timeline-item"); if (node) node.style.paddingTop = "80px"; },
      jump: (sequence) => timeline.current?.toSequence(sequence),
      reads: reads.current,
    };
  }, []);
  function replyTo(message: FixtureMessage) {
    setReply(message.id); setEditing(false); composer.current?.focus({ preventScroll: true });
  }
  return <section className="conversation-view">
    <div role="status">{notice || (reply ? `Reply ${reply}` : editing ? "Editing" : id)}</div>
    <MessageTimeline
      ref={timeline}
      items={messages}
      visibleCount={visibleCount}
      currentUserId="me"
      onReadLatest={async (sequence) => { reads.current.push(sequence); }}
      childrenBefore={<button type="button" onClick={() => setVisibleCount((value) => value + 120)}>Show earlier messages</button>}
      renderMessage={(message) => <div className={`message-row ${message.senderId === CURRENT_USER ? "own" : ""}`}>
        <div className="message-bubble-wrap">
          <MessageInteraction onActions={() => setAction(message)} onReply={() => replyTo(message)}>
            <div className="message-bubble"><p>{message.body}</p>
              {message.id === "m140" ? <button type="button" onClick={() => setNotice("Media control clicked")}>Media control</button> : null}
              <MessageMeta createdAt={message.createdAt} sequence={message.sequence} own={message.senderId === CURRENT_USER} peerReads={[0]} />
            </div>
          </MessageInteraction>
          <button className="message-more-button" aria-label={`Actions ${message.id}`} onClick={() => setAction(message)}>•••</button>
        </div>
      </div>}
    />
    {action ? <MessageActionSheet preview={action.body} onClose={() => setAction(null)} actions={[
      {id:"reply",label:"Reply",run:()=>replyTo(action)},
      {id:"edit",label:"Edit",run:()=>{setEditing(true);setReply("");setEditBody(action.body);composer.current?.focus({preventScroll:true});}},
      {id:"delete",label:"Delete",destructive:true,run:()=>{setMessages((current)=>current.filter((item)=>item.id!==action.id));setNotice("Deleted");}},
    ]} /> : null}
    <div className="composer">
      <button type="button" aria-label="Attach">+</button>
      <textarea aria-label="Message" ref={composer} value={editing ? editBody : draft} onChange={(event) => editing ? setEditBody(event.target.value) : setDraft(event.target.value)} />
      {editing ? <button type="button" aria-label="Cancel edit" onClick={() => { setEditing(false); setEditBody(""); }}>Cancel edit</button> : null}
    </div>
  </section>;
}
function Fixture() {
  const [selected, setSelected] = useState("chat-a");
  const [visible, setVisible] = useState(true);
  const [account, setAccount] = useState(1);
  return <main className="messenger-page"><section className="messenger-shell minimal-messenger-frame messenger-runtime-shell">
    <header className="messenger-topbar"><button onClick={() => setSelected("chat-a")}>Chat A</button><button onClick={() => setSelected("chat-b")}>Chat B</button><button onClick={() => setVisible((value)=>!value)}>{visible ? "Hide" : "Show"}</button><button onClick={() => setAccount((value)=>value+1)}>Change account</button></header>
    {visible ? <ConversationDraftProvider key={account}><Chat key={selected} id={selected} /></ConversationDraftProvider> : <p>Sudoku</p>}
  </section></main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);

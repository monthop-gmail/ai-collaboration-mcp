มีจร้า ผมว่าตอนนี้ควรแจ้งทีม **เรื่องสำคัญ 6 ข้อ** แต่ไม่ต้องให้ทีมรีบทำทุกอย่างนะ — เน้น “ปรับทิศทาง” ก่อน

ฝากทีม `ai-collaboration-mcp` เพิ่มแนวทางจากที่ทดลองและคุยกันล่าสุดครับ

### 1. เป้าหมายของ repo

ให้ยึด concept หลักว่า

> **AI Collaboration MCP = Shared Collaboration / Context Layer ของ AI Ecosystem**

ไม่ใช่ Agent Platform และไม่ใช่ Multi-Agent Orchestrator

หน้าที่หลักคือทำให้ ChatGPT / Claude / Gemini / Agent ต่าง ๆ สามารถเข้ามาอยู่ใน **Workspace เดียวกัน** และเห็น discussion, context, proposal, review และ decision เดียวกัน

---

### 2. Use case หลักที่เราจะใช้จริง

ปกติ workflow ของเราคือ

```text
คุยกับ AI
   ↓
ได้ภาพรวม + แนวทาง + แผนงาน
   ↓
ส่งให้ทีม implement
```

อยากเปลี่ยนเป็น

```text
คุย / สำรวจ
   ↓
AI Collaboration MCP
   ↓
Discussion / Plan / Decision
   ↓
Task / Handoff
   ↓
ทีม / Agent / Harness
   ↓
Implement
```

ดังนั้น MCP ตัวนี้ควรรองรับ **จุดเปลี่ยนจาก “การคุย” → “งานที่มี context”**

---

### 3. เพิ่ม Concept `Plan`

ใน Phase ถัดไป อยากให้มี concept ของ `Plan` แยกจาก chat message

เช่น

```text
Discussion
 ├── Proposal
 ├── Review
 ├── Question
 ├── Plan
 └── Decision
```

โดย Plan ควรสามารถอ้างอิง discussion/decision ที่เป็นต้นทางได้

ยังไม่จำเป็นต้องทำ Kanban ใน repo นี้

---

### 4. อย่ารีบทำ Kanban / Agent Orchestration

เรื่อง

* Backlog
* Todo
* In Progress
* Review
* Done
* Agent assignment
* Agent execution

ควรให้ **Hermes / Agent Platform** รับผิดชอบ

ภาพรวมที่อยากรักษาไว้คือ

```text
AI Collaboration MCP
       │
       │ Think / Discuss / Decide
       ▼
Agent Platform
       │
       │ Orchestrate
       ▼
Hermes / Harness
       │
       │ Execute
       ▼
GitHub / Tools / MCP
```

จะได้ไม่เกิด Agent Platform ซ้ำซ้อนใน repo นี้

---

### 5. Priority ตอนนี้

ก่อนเพิ่ม feature เยอะ ๆ อยากให้ทีมพิสูจน์ **Multi-AI Collaboration Loop** กับ AI จริงก่อน

Scenario:

```text
ChatGPT
  ↓
create discussion
  ↓
Claude
  ↓
read + review
  ↓
Gemini
  ↓
read ทั้งหมด + เพิ่มความคิดเห็น
  ↓
ChatGPT
  ↓
สรุปกลับ
```

ถ้า loop นี้ผ่าน ถือว่า core hypothesis ของ repo ผ่าน

จาก README ตอนนี้ Phase 1 ยิงผ่าน curl ได้แล้ว แต่ยังไม่ได้ทดสอบกับ AI จริง ดังนั้นนี่ควรเป็น milestone สำคัญถัดไป

---

### 6. หลักการระยะยาว

อยากให้ repo นี้เป็น **provider-neutral**

ไม่ออกแบบผูกกับ

```text
ChatGPT
Claude
Gemini
```

แต่คิดเป็น

```text
AI Client
    ↓
MCP
    ↓
Common Collaboration Model
```

เพื่อให้ต่อไป coding agent, Hermes, Qwen, Codex หรือ agent อื่น ๆ สามารถเข้ามาร่วม workspace เดียวกันได้

**สรุป:** ตอนนี้ยังไม่ต้องทำให้ใหญ่ครับ ขอให้ทำ “โต๊ะประชุมกลางของ AI” ให้ใช้งานจริงก่อน แล้วค่อยต่อ Plan → Decision → Task/Handoff → Agent Platform ภายหลัง

ผมว่า message นี้ส่งให้ทีมได้เลยจร้า โดยเฉพาะ **ข้อ 5 สำคัญที่สุด** — เราควรพิสูจน์ของจริงก่อน แล้วค่อยขยาย architecture ครับ.

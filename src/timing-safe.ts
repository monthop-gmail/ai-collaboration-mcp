/**
 * เทียบสตริงสองตัวโดยใช้เวลาไม่ขึ้นกับว่าต่างกันตรงตำแหน่งไหน
 *
 * ใช้เทียบ `approval_code` กับ `APPROVAL_SECRET` · `!==` ของ JS หยุดทันทีที่เจอ byte
 * แรกที่ไม่ตรง เวลาที่ใช้จึงบอกได้ว่าเดาถูกไปกี่ตัวแล้ว
 *
 * เขียนเองแทน `crypto.subtle.timingSafeEqual` เพราะตัวนั้นมีเฉพาะบน Workers และ
 * โยน error เมื่อความยาวไม่เท่ากัน · ตัวนี้วนครบตามสตริงที่ยาวกว่าเสมอ แล้วนำ
 * ความต่างของความยาวเข้าตัวสะสมด้วย ไม่ return ก่อนวนครบ
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  const len = Math.max(x.length, y.length);

  let diff = x.length ^ y.length;
  for (let i = 0; i < len; i++) {
    // นอกช่วงของตัวที่สั้นกว่าอ่านได้ undefined → ใช้ 0 แทน ความต่างของความยาวถูกนับไปแล้วข้างบน
    diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  }
  return diff === 0;
}

# Column-Level Privileges สำหรับ Channel Secrets & Access Tokens

channel_secret และ access_token เป็นข้อมูล sensitive — หากหลุดรอด = เข้าถึง Channel บน LINE ได้ ตัดสินใจใช้ Supabase column-level privileges revoke SELECT บนสองคอลัมน์นี้จากทุก role ยกเว้น service_role แทนการใช้ Supabase Vault ($10/เดือน) หรือ encrypt ด้วย pgcrypto

บริการ Quota Collector (backend) ใช้ service_role key อ่านได้ทุกคอลัมน์ — ใช้ token เรียก LINE API โดยไม่ต้อง decrypt Frontend อ่านได้เฉพาะคอลัมน์ที่ไม่ sensitive — ไม่มีทางหลุดผ่าน browser devtools

ข้อแลก: token เก็บแบบ plain text ใน database — ไม่ถูกเข้ารหัส at rest แต่ RLS + column-level privileges ป้องกันการเข้าถึงที่ไม่ได้รับอนุญาต ก่อน production จริงควรพิจารณา Supabase Vault เมื่อมีงบประมาณ

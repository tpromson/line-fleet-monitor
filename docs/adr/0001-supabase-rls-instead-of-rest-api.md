# Supabase RLS + Direct Client แทน Express REST API

PRD เดิมออกแบบ REST API (Express) คั่นระหว่าง React frontend กับ Supabase เพื่อควบคุม authorization ตัดสินใจเปลี่ยนเป็น Supabase client โดยตรงจาก frontend + Row Level Security (RLS) แทน ลดการเขียน CRUD boilerplate ไปได้ทั้งหมด Express backend เหลือแค่ cron scheduler สำหรับ Quota Collector เท่านั้น

เหตุผลเลือก: เขียนโค้ดน้อยลงมาก, เร็วกว่า (ไม่มี intermediate hop), RLS ปลอดภัยเพียงพอสำหรับ MVP (enforce authorization ในระดับ database), และลดจำนวน service ที่ต้อง maintain

ข้อแลก: ไม่มี centralized middleware สำหรับ cross-cutting concerns (logging, caching) — ต้องเพิ่มทีหลังถ้าจำเป็น

# LINE Fleet Monitor

ระบบติดตามการใช้งาน LINE Messaging API แบบรวมศูนย์สำหรับหลาย LINE Official Account ผ่านหน้า Dashboard เดียว

## Language

**Organization**:
กลุ่มผู้ใช้งานที่เป็นเจ้าของ Provider และ Channel หนึ่งองค์กรมีได้หลาย Provider แต่ละ Provider สังกัดได้เพียง Organization เดียว User หนึ่งคนเป็นสมาชิกได้หลาย Organization โดยมี role ที่แตกต่างกันในแต่ละ Organization
_Avoid_: Tenant, Company, Team

**Provider**:
หน่วยจัดกลุ่ม Channel บน LINE Developer Console ตามโครงสร้างของ LINE API หนึ่ง Provider อยู่ภายใต้ Organization เดียว
_Avoid_: Service, Project

**Channel**:
LINE Messaging API Channel ซึ่งคือ LINE Official Account ในมุมเทคนิค สิ่งที่ถูกติดตาม Quota, Webhook และการใช้งาน
_Avoid_: OA, LINE Account, Bot, Account

**Quota**:
ปริมาณ Push Message ที่ Channel หนึ่งส่งได้ต่อเดือน ประกอบด้วย limit (ตั้งค่าโดย Admin) และ usage (ดึงจาก LINE API) ติดตามต่อ Channel
_Avoid_: Allowance, Capacity

**Alert**:
การแจ้งเตือนเมื่อ Quota ของ Channel ข้าม threshold ที่กำหนด ระดับ Warning (>80%) และ Critical (>95%) แจ้งเฉพาะเมื่อข้าม threshold ครั้งแรก ไม่แจ้งซ้ำขณะที่ยังอยู่ในระดับเดิม
_Avoid_: Notification, Alarm

**Forecast**:
การคาดการณ์วันที่ Quota จะหมด จากอัตราการใช้งานเฉลี่ยตั้งแต่ต้นเดือน (ใช้แล้ว / วันที่ผ่านมา) เทียบกับ remaining ที่เหลือ
_Avoid_: Prediction, Estimation

**Webhook Status**:
สถานะการเชื่อมต่อ Webhook ของ Channel ตรวจสอบผ่าน LINE API test endpoint มีสามสถานะ: Online (ตอบสนอง), Warning (ตอบสนองช้า), Offline (ไม่ตอบสนอง)
_Avoid_: Connection Status, Health

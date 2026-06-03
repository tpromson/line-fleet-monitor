/**
 * IoTcenter Client for Google Apps Script
 * ส่ง events และ heartbeat ไปยัง IoTcenter API
 *
 * วิธีใช้:
 *   IoTcenter.init(CONFIG.apiUrl, CONFIG.apiKey, CONFIG.deviceName)
 */
var IoTcenter = (function() {
  'use strict';

  var _apiUrl = '';
  var _apiKey = '';
  var _deviceName = '';
  var _deviceType = '';

  function init(apiUrl, apiKey, deviceName, deviceType) {
    _apiUrl = apiUrl;
    _apiKey = apiKey;
    _deviceName = deviceName || '';
    _deviceType = deviceType || 'google_apps_script';
  }

  function _callApi(path, payload) {
    if (!_apiUrl || !_apiKey) {
      Logger.log('[IoTcenter] Not initialized. Skipping.');
      return null;
    }

    var options = {
      method: 'POST',
      headers: {
        'X-API-Key': _apiKey,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    try {
      var response = UrlFetchApp.fetch(_apiUrl + path, options);
      var status = response.getResponseCode();

      if (status === 201 || status === 200) {
        return JSON.parse(response.getContentText());
      }

      Logger.log('[IoTcenter] Error ' + status + ': ' + response.getContentText());
      return null;
    } catch (e) {
      Logger.log('[IoTcenter] Connection error: ' + e.toString());
      return null;
    }
  }

  function sendEvent(eventType, level, message, payload) {
    var data = {
      event_type: eventType,
      level: level || 'info',
      message: message || ''
    };
    if (payload) data.payload = payload;
    return _callApi('/api/iotcenter/events', data);
  }

  function sendHeartbeat(deviceName, deviceType, metadata) {
    var data = {
      device_name: deviceName || _deviceName,
      device_type: deviceType || _deviceType
    };
    if (metadata) data.metadata = metadata;
    return _callApi('/api/iotcenter/heartbeat', data);
  }

  return {
    init: init,
    sendEvent: sendEvent,
    sendHeartbeat: sendHeartbeat
  };
})();

// ============================================================
// CONFIG — แก้ไข API Key จาก Setup → Sources → API Key
// ============================================================
var CONFIG = {
  apiUrl: 'https://line-fleetbackend-production.up.railway.app',
  apiKey: 'd77b962c-da7f-44a0-8ef5-9db80fb14e03',
  deviceName: 'TempBot_ward1',
  deviceType: 'google_apps_script'
};

// ==========================================
// การตั้งค่าระบบ (Configuration)
// ==========================================
var TARGET_SPREADSHEET_ID = "1cEC6cUDpnCRLXWDzytiIHTtFIXXHuR20RhjXUCvyXF4"; 

var TEMP_COLUMN = 3; // คอลัมน์ C (A=1, B=2, C=3)
var TEMP_IDX = TEMP_COLUMN - 1; // สำหรับดึงค่าจาก Array (A=0, B=1, C=2)
var THRESHOLD = 10; // อุณหภูมิแจ้งเตือน
var MAX_PLAUSIBLE_TEMP = 20;
var MIN_PLAUSIBLE_TEMP = -10;

// ==========================================
// บอก IoTcenter ว่า Bot ยังทำงานอยู่
// ==========================================
function heartbeat() {
  IoTcenter.init(CONFIG.apiUrl, CONFIG.apiKey, CONFIG.deviceName, CONFIG.deviceType);

  var sheet = getTargetSheet();
  var lastRow = sheet.getLastRow();
  var lastTemp = lastRow >= 2 ? sheet.getRange(lastRow, TEMP_COLUMN).getValue() : null;

  IoTcenter.sendHeartbeat(CONFIG.deviceName, CONFIG.deviceType, {
    lastTemperature: lastTemp,
    lastRow: lastRow
  });
}

// ==========================================
// ฟังก์ชันสำหรับเปิดไฟล์และชีตเป้าหมาย
// ==========================================
function getTargetSheet() {
  var ss = SpreadsheetApp.openById(TARGET_SPREADSHEET_ID);
  return ss.getSheets()[0];
}

function getConfig() {
  const props = PropertiesService.getScriptProperties();
  return {
    token: props.getProperty('ACCESS_TOKEN'),
    groupId: props.getProperty('GROUP_ID')
  };
}

// ==========================================
// ฟังก์ชันส่งข้อความ LINE Messaging API
// ==========================================
function pushMessage(text) {
  const config = getConfig();
  
  if (!config.token || !config.groupId) {
    Logger.log("Error: ลืมตั้งค่า ACCESS_TOKEN หรือ GROUP_ID ใน Script Properties");
    return;
  }

  var url = "https://api.line.me/v2/bot/message/push";
  var payload = {
    "to": config.groupId,
    "messages": [{"type": "text", "text": text}]
  };
  var options = {
    "method": "post",
    "contentType": "application/json",
    "headers": {"Authorization": "Bearer " + config.token},
    "payload": JSON.stringify(payload)
  };
  
  try {
    UrlFetchApp.fetch(url, options);
  } catch (e) {
    Logger.log("Error sending message: " + e.message);
  }
}

// ==========================================
// ฟังก์ชันเช็คสถานะ Sensor (รันทุกๆ 30-40 นาที)
// ==========================================
function checkSensorStatus() {
  IoTcenter.init(CONFIG.apiUrl, CONFIG.apiKey, CONFIG.deviceName, CONFIG.deviceType);

  var sheet = getTargetSheet();
  var lastRow = sheet.getLastRow();
  
  if (lastRow < 2) {
    IoTcenter.sendHeartbeat();
    return;
  }

  var lastValue = sheet.getRange(lastRow, 1).getValue();
  var lastTemp = sheet.getRange(lastRow, TEMP_COLUMN).getValue(); 
  
  var props = PropertiesService.getScriptProperties();
  var lastStatus = props.getProperty("SENSOR_STATUS");

  var lastDate = parseDate(lastValue);

  if (lastDate && !isNaN(lastDate.getTime())) {
    var now = new Date();
    var diffInMinutes = (now.getTime() - lastDate.getTime()) / (1000 * 60);

    if (diffInMinutes > 35) {
      if (lastStatus !== "OFFLINE") {
        var lastTimeStr = Utilities.formatDate(lastDate, Session.getScriptTimeZone(), "HH:mm (dd/MM/yyyy)");
        
        pushMessage("🚨 ขาดการติดต่อจาก Sensor!\n" +
                    "--------------------------\n" +
                    "🌡️ อุณหภูมิล่าสุด: " + lastTemp + " °C\n" +
                    "🕒 เมื่อเวลา: " + lastTimeStr + "\n" +
                    "📢 กรุณาตรวจสอบอุปกรณ์");
        
        props.setProperty("SENSOR_STATUS", "OFFLINE");

        IoTcenter.sendEvent(
          'SENSOR_OFFLINE',
          'critical',
          'Sensor ขาดการติดต่อ > ' + Math.round(diffInMinutes) + ' นาที',
          { lastTemperature: lastTemp, lastContact: lastDate.toISOString(), minutesSinceLastContact: Math.round(diffInMinutes) }
        );
      }
    } 
    else {
      if (lastStatus === "OFFLINE") {
        pushMessage("✅ Sensor กลับมาทำงานปกติแล้ว!\n" +
                    "--------------------------\n" +
                    "🌡️ อุณหภูมิปัจจุบัน: " + lastTemp + " °C\n" +
                    "⏰ เริ่มบันทึกต่อเมื่อ: " + Utilities.formatDate(lastDate, Session.getScriptTimeZone(), "HH:mm"));
        
        props.setProperty("SENSOR_STATUS", "OK");

        IoTcenter.sendEvent(
          'SENSOR_RECOVERY',
          'recovery',
          'Sensor กลับมาทำงานปกติ',
          { temperature: lastTemp }
        );
      }
    }
  }

  IoTcenter.sendHeartbeat();
}

// ==========================================
// 1. แจ้งเตือนเมื่ออุณหภูมิเกิน (Alert)
// ==========================================
function checkTemperatureAlert() {
  IoTcenter.init(CONFIG.apiUrl, CONFIG.apiKey, CONFIG.deviceName, CONFIG.deviceType);

  var sheet = getTargetSheet();
  var lastRow = sheet.getLastRow();
  
  if (lastRow < 2) {
    IoTcenter.sendHeartbeat();
    return;
  }

  var currentTemp = sheet.getRange(lastRow, TEMP_COLUMN).getValue();
  
  if (!isNaN(currentTemp) && currentTemp <= MAX_PLAUSIBLE_TEMP) {
    if (currentTemp >= THRESHOLD) {
      pushMessage("⚠️ แจ้งเตือน! อุณหภูมิสูงเกินกำหนด\n" +
                  "--------------------------\n" +
                  "🌡️ อุณหภูมิปัจจุบัน: " + currentTemp.toFixed(1) + " °C\n" +
                  "❗ เกณฑ์ที่ตั้งไว้: " + THRESHOLD + " °C\n" +
                  "📢 โปรดตรวจสอบความเย็น!");

      IoTcenter.sendEvent(
        'HIGH_TEMP',
        'warning',
        'อุณหภูมิเกินเกณฑ์: ' + currentTemp.toFixed(1) + '°C (threshold: ' + THRESHOLD + '°C)',
        { temperature: currentTemp, threshold: THRESHOLD, unit: 'celsius' }
      );
    } else {
      IoTcenter.sendEvent(
        'TEMP_NORMAL',
        'info',
        'อุณหภูมิปกติ: ' + currentTemp.toFixed(1) + '°C',
        { temperature: currentTemp }
      );
    }
  }

  IoTcenter.sendHeartbeat();
}

// ==========================================
// 2. ฟังก์ชันส่งรายงานสรุปประจำวัน
// ==========================================
function sendDailySummary() {
  IoTcenter.init(CONFIG.apiUrl, CONFIG.apiKey, CONFIG.deviceName, CONFIG.deviceType);

  var sheet = getTargetSheet();
  var data = sheet.getDataRange().getValues();
  
  var yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  var targetDateStr = Utilities.formatDate(yesterday, Session.getScriptTimeZone(), "dd/MM/yyyy");
  
  var validCount = 0;
  var minTemp = Infinity;
  var maxTemp = -Infinity;
  var sumTemp = 0; 

  for (var i = data.length - 1; i >= 1; i--) {
    var valDate = data[i][0];
    if (!valDate) continue;

    var rowDate = parseDate(valDate);
    if (isNaN(rowDate.getTime())) continue;

    var rowDateStr = Utilities.formatDate(rowDate, Session.getScriptTimeZone(), "dd/MM/yyyy");
    
    if (rowDateStr === targetDateStr) {
      var temp = parseFloat(data[i][TEMP_IDX]);
      if (!isNaN(temp) && temp <= MAX_PLAUSIBLE_TEMP && temp >= MIN_PLAUSIBLE_TEMP) {
        if (temp < minTemp) minTemp = temp;
        if (temp > maxTemp) maxTemp = temp;
        sumTemp += temp; 
        validCount++;
      }
    } else if (validCount > 0) {
      break; 
    }
  }

  if (validCount > 0) {
    var avgTemp = sumTemp / validCount; 
    var messageText = "📊 รายงานสรุปอุณหภูมิประจำวัน: " + targetDateStr + "\n" +
                      "--------------------------\n" +
                      "🌡️ สูงสุด: " + maxTemp.toFixed(1) + " °C\n" +
                      "❄️ ต่ำสุด: " + minTemp.toFixed(1) + " °C\n" +
                      "📈 ค่าเฉลี่ย: " + avgTemp.toFixed(1) + " °C";

    pushMessage(messageText);

    IoTcenter.sendEvent(
      'DAILY_REPORT',
      'info',
      'สรุปอุณหภูมิ ' + targetDateStr + ' | สูงสุด ' + maxTemp.toFixed(1) + '°C / ต่ำสุด ' + minTemp.toFixed(1) + '°C / เฉลี่ย ' + avgTemp.toFixed(1) + '°C',
      { date: targetDateStr, maxTemp: maxTemp, minTemp: minTemp, avgTemp: avgTemp, recordsCount: validCount }
    );
  } else {
    pushMessage("⚠️ ไม่พบข้อมูลของวันที่ " + targetDateStr);

    IoTcenter.sendEvent(
      'DAILY_REPORT_EMPTY',
      'warning',
      'ไม่พบข้อมูลวันที่ ' + targetDateStr,
      { date: targetDateStr }
    );
  }

  IoTcenter.sendHeartbeat();
}

// ==========================================
// 3. สรุปตามรอบเวลา 8 ชั่วโมง
// ==========================================
function sendReport_00_08() { 
  generateReport(0, 8, "00.00-08.00", 0); 
}

function sendReport_08_16() { 
  generateReport(8, 16, "08.00-16.00", 0); 
}

function sendReport_16_00() { 
  generateReport(16, 24, "16.00-24.00", -1); 
}

function generateReport(startHour, endHour, periodName, daysOffset) {
  IoTcenter.init(CONFIG.apiUrl, CONFIG.apiKey, CONFIG.deviceName, CONFIG.deviceType);

  var sheet = getTargetSheet();
  var data = sheet.getDataRange().getValues();
  
  var targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + daysOffset);
  
  var targetD = targetDate.getDate();
  var targetM = targetDate.getMonth();
  var targetY = targetDate.getFullYear();
  
  var minTemp = Infinity;
  var maxTemp = -Infinity;
  var sumTemp = 0; 
  var count = 0; 
  var hasData = false;
  
  for (var i = 1; i < data.length; i++) {
    var dateObj = parseDate(data[i][0]);
    if (isNaN(dateObj.getTime())) continue;

    if (dateObj.getDate() === targetD && dateObj.getMonth() === targetM && dateObj.getFullYear() === targetY) {
      var rowHour = dateObj.getHours();
      if (rowHour >= startHour && rowHour < endHour) {
        var temp = parseFloat(data[i][TEMP_IDX]);
        
        if (!isNaN(temp) && temp <= MAX_PLAUSIBLE_TEMP && temp >= MIN_PLAUSIBLE_TEMP) {
          if (temp < minTemp) minTemp = temp;
          if (temp > maxTemp) maxTemp = temp;
          sumTemp += temp; 
          count++; 
          hasData = true;
        }
      }
    }
  }
  
  if (hasData) {
    var avgTemp = sumTemp / count; 
    var dateString = Utilities.formatDate(targetDate, Session.getScriptTimeZone(), "dd/MM/yyyy");
    var message = "📊 สรุปอุณหภูมิรอบเวลา " + periodName + "\n" +
                  "📅 วันที่: " + dateString + "\n" +
                  "--------------------------\n" +
                  "🌡 สูงสุด: " + maxTemp.toFixed(1) + " °C\n" +
                  "❄ ต่ำสุด: " + minTemp.toFixed(1) + " °C\n" +
                  "📈 ค่าเฉลี่ย: " + avgTemp.toFixed(1) + " °C"; 
    pushMessage(message);

    IoTcenter.sendEvent(
      'SHIFT_REPORT',
      'info',
      'สรุปรอบ ' + periodName + ' – ' + dateString + ' | สูงสุด ' + maxTemp.toFixed(1) + '°C / ต่ำสุด ' + minTemp.toFixed(1) + '°C / เฉลี่ย ' + avgTemp.toFixed(1) + '°C',
      { period: periodName, date: dateString, maxTemp: maxTemp, minTemp: minTemp, avgTemp: avgTemp, recordsCount: count }
    );
  } else {
    pushMessage("⚠️ ยังไม่พบข้อมูลช่วง " + periodName);

    IoTcenter.sendEvent(
      'SHIFT_REPORT_EMPTY',
      'warning',
      'ไม่พบข้อมูลช่วง ' + periodName,
      { period: periodName }
    );
  }

  IoTcenter.sendHeartbeat();
}

// ==========================================
// ฟังก์ชันช่วยแปลงวันที่
// ==========================================
function parseDate(valDate) {
  if (valDate instanceof Date) return valDate;
  var cleanStr = valDate.toString().replace(/-/g, "/").trim();
  var dateObj = new Date(cleanStr);
  
  if (isNaN(dateObj.getTime())) {
    var m = cleanStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) {
      dateObj = new Date(m[3], m[2]-1, m[1]);
      var hMatch = cleanStr.match(/\s(\d{1,2}):(\d{1,2})/);
      if (hMatch) {
        dateObj.setHours(hMatch[1]);
        dateObj.setMinutes(hMatch[2]);
      }
    }
  }
  return dateObj;
}

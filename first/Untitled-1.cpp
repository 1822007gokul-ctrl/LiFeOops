#define BLYNK_TEMPLATE_ID "TMPL3eh_dAM4K"
#define BLYNK_TEMPLATE_NAME "Accident status"
#define BLYNK_AUTH_TOKEN "kZRRZf0DCj1HxOFQOb02Iuex_tBtezFh"

#include <ESP8266WiFi.h>
#include <BlynkSimpleEsp8266.h>
#include <Wire.h>
#include <MPU6050.h>
#include <ESP8266HTTPClient.h>

char ssid[] = "ESPTEST";
char pass[] = "987654321";

BlynkTimer timer;

MPU6050 mpu1(0x68);
MPU6050 mpu2(0x69);

#define SW1 D5
#define SW2 D6
#define SW3 D7
#define BUZZER D8

unsigned long tiltTime = 0;
unsigned long col1Time = 0;
unsigned long col2Time = 0;
unsigned long col3Time = 0;
unsigned long buzzerStart = 0;

const unsigned long showDuration = 10000;

bool blinkState = false;
bool alertSent = false;

String IFTTT_KEY = "pbSFfOVkIRTm_f1DqgYbLPtDNkd8ivcmTlWPXy29nad";

void sendIFTTTAlert(String msg)
{
  WiFiClient client;
  HTTPClient http;

  String url =
    "http://maker.ifttt.com/trigger/accident_alert/with/key/"
    + IFTTT_KEY;

  http.begin(client, url);
  http.addHeader("Content-Type", "application/json");

  String body = "{\"value1\":\"" + msg + "\"}";

  http.POST(body);
  http.end();
}

int readCollision(int pin)
{
  int count = 0;

  for(int i = 0; i < 5; i++)
  {
    if(digitalRead(pin) == HIGH)
      count++;

    delay(3);
  }

  if(count >= 3)
    return 1;
  else
    return 0;
}

void readSensors()
{
  int collision1 = readCollision(SW1);
  int collision2 = readCollision(SW2);
  int collision3 = readCollision(SW3);

  int16_t ax1, ay1, az1;
  int16_t ax2, ay2, az2;

  mpu1.getAcceleration(&ax1, &ay1, &az1);
  mpu2.getAcceleration(&ax2, &ay2, &az2);

  float x1 = ax1 / 16384.0;
  float y1 = ay1 / 16384.0;

  float x2 = ax2 / 16384.0;
  float y2 = ay2 / 16384.0;

  Blynk.virtualWrite(V0, x1);
  Blynk.virtualWrite(V1, x2);

  bool tilt = false;

  if(abs(x1) > 0.6 || abs(y1) > 0.6 ||
     abs(x2) > 0.6 || abs(y2) > 0.6)
  {
    tilt = true;
  }

  if(tilt)
    tiltTime = millis();

  if(collision1)
    col1Time = millis();

  if(collision2)
    col2Time = millis();

  if(collision3)
    col3Time = millis();

  String accidentMsg = "";

  if(millis() - tiltTime < showDuration)
    accidentMsg += "VEHICLE TILT DETECTED\n";

  if(millis() - col1Time < showDuration)
    accidentMsg += "FRONT COLLISION DETECTED\n";

  if(millis() - col2Time < showDuration)
    accidentMsg += "LEFT COLLISION DETECTED\n";

  if(millis() - col3Time < showDuration)
    accidentMsg += "RIGHT COLLISION DETECTED\n";

  if(accidentMsg == "")
  {
    accidentMsg = "VEHICLE STATUS SAFE";
    alertSent = false;
  }

  if(accidentMsg != "VEHICLE STATUS SAFE" && !alertSent)
  {
    sendIFTTTAlert(accidentMsg);

    buzzerStart = millis();
    digitalWrite(BUZZER, HIGH);

    alertSent = true;
  }

  Serial.println(accidentMsg);

  Blynk.virtualWrite(V6, accidentMsg);

  if(millis() - buzzerStart < showDuration &&
     accidentMsg != "VEHICLE STATUS SAFE")
  {
    digitalWrite(BUZZER, HIGH);
  }
  else
  {
    digitalWrite(BUZZER, LOW);
  }
}

void blinkLEDs()
{
  blinkState = !blinkState;

  if(millis() - col1Time < showDuration)
    Blynk.virtualWrite(V2, blinkState);
  else
    Blynk.virtualWrite(V2, 0);

  if(millis() - col2Time < showDuration)
    Blynk.virtualWrite(V3, blinkState);
  else
    Blynk.virtualWrite(V3, 0);

  if(millis() - col3Time < showDuration)
    Blynk.virtualWrite(V4, blinkState);
  else
    Blynk.virtualWrite(V4, 0);
}

void setup()
{
  Serial.begin(115200);

  Wire.begin(D2, D1);

  mpu1.initialize();
  mpu2.initialize();

  pinMode(SW1, INPUT);
  pinMode(SW2, INPUT);
  pinMode(SW3, INPUT);

  pinMode(BUZZER, OUTPUT);
  digitalWrite(BUZZER, LOW);

  Blynk.begin(BLYNK_AUTH_TOKEN, ssid, pass);

  timer.setInterval(200L, readSensors);
  timer.setInterval(300L, blinkLEDs);
}

void loop()
{
  Blynk.run();
  timer.run();
}
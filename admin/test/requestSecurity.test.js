import test from "node:test";
import assert from "node:assert/strict";
import {
  isAllowedRequestHostname,
  isAllowedRequestOrigin,
  normalizeHostname
} from "../src/services/requestSecurity.js";

test("request hostname checks accept only configured admin/public hosts", () => {
  assert.equal(normalizeHostname("Manager.Example.com:443"), "manager.example.com");
  assert.equal(isAllowedRequestHostname("manager.example.com", {
    adminHostname: "manager.example.com"
  }), true);
  assert.equal(isAllowedRequestHostname("customer.example.com", {
    adminHostname: "manager.example.com",
    publicHostname: "customer.example.com"
  }), true);
  assert.equal(isAllowedRequestHostname("attacker.example", {
    adminHostname: "manager.example.com"
  }), false);
  assert.equal(isAllowedRequestHostname("manager.example.com.attacker.example", {
    adminHostname: "manager.example.com"
  }), false);
});

test("request origin checks compare exact configured origins", () => {
  assert.equal(isAllowedRequestOrigin("https://manager.example.com/settings", "https://manager.example.com"), true);
  assert.equal(isAllowedRequestOrigin("https://attacker.example", "https://manager.example.com"), false);
  assert.equal(isAllowedRequestOrigin("not-a-url", "https://manager.example.com"), false);
  assert.equal(isAllowedRequestOrigin("", "https://manager.example.com"), true);
});

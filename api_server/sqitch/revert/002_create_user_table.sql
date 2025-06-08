-- Revert llm_chat:create_user_table from pg

BEGIN;

-- 设备注册信息表
drop table if exists device_registration;

-- 设备登录历史
drop table if exists device_login_history;

-- 设备历史信息
drop table if exists device_info_history;

-- 设备信息
drop table if exists device_info;

-- 用户登录历史
drop table if exists user_login_history;

-- 用户认证历史
drop table if exists user_credential_history;

-- 用户认证信息
drop table if exists user_credential;

-- 用户信息
drop table if exists user_info;

COMMIT;

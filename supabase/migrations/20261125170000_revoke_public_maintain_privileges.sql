-- PostgreSQL 17 MAINTAIN is a table maintenance privilege; revoke it from API client roles.
revoke maintain on all tables in schema public from anon, authenticated, public;

-- Do not let future public tables inherit MAINTAIN for API client roles.
alter default privileges for role postgres in schema public
  revoke maintain on tables from anon, authenticated, public;

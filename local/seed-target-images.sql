-- Disable old placeholder images and register real CVE-based targets.
UPDATE target_images SET enabled = false;

INSERT INTO target_images (id, name, docker_image, tier, difficulty, description, ssh_port, web_port, enabled) VALUES
  ('apache-rce',
   'Apache Path Traversal',
   'cyberkiller/target-apache-rce:latest',
   'neon', 'easy',
   'CVE-2021-41773 · Apache 2.4.49 path traversal + CGI RCE. Mod_cgi enabled, traverse out of docroot.',
   22, 80, true),

  ('shellshock',
   'Shellshock CGI',
   'cyberkiller/target-shellshock:latest',
   'neon', 'easy',
   'CVE-2014-6271 · Bash 4.3 shellshock via HTTP headers in Apache CGI script.',
   22, 80, true),

  ('tomcat-upload',
   'Tomcat JSP Upload',
   'cyberkiller/target-tomcat-upload:latest',
   'neon', 'easy',
   'CVE-2017-12615 · Tomcat 8.5.19 HTTP PUT uploads arbitrary JSP files.',
   22, 80, true),

  ('struts-ognl',
   'Struts OGNL Injection',
   'cyberkiller/target-struts-ognl:latest',
   'shadow', 'medium',
   'CVE-2017-5638 · Apache Struts 2.5.10 Content-Type header OGNL expression RCE.',
   22, 80, true),

  ('log4shell',
   'Log4Shell',
   'cyberkiller/target-log4shell:latest',
   'shadow', 'medium',
   'CVE-2021-44228 · Log4j 2.14.1 JNDI injection via Apache Solr 8.11.0 query params.',
   22, 80, true),

  ('spring4shell',
   'Spring4Shell',
   'cyberkiller/target-spring4shell:latest',
   'shadow', 'medium',
   'CVE-2022-22965 · Spring Framework 5.3.17 data binding classLoader manipulation RCE.',
   22, 80, true),

  ('jenkins-rce',
   'Jenkins Groovy RCE',
   'cyberkiller/target-jenkins-rce:latest',
   'shadow', 'medium',
   'CVE-2018-1000861 · Jenkins 2.138 unauthenticated Groovy script execution via Stapler routing.',
   22, 80, true),

  ('elasticsearch-rce',
   'Elasticsearch Groovy',
   'cyberkiller/target-elasticsearch-rce:latest',
   'citadel', 'hard',
   'CVE-2015-1427 · Elasticsearch 1.4.2 Groovy sandbox escape via script_fields API.',
   22, 80, true)

ON CONFLICT (id) DO UPDATE SET
  name        = EXCLUDED.name,
  docker_image = EXCLUDED.docker_image,
  tier        = EXCLUDED.tier,
  difficulty  = EXCLUDED.difficulty,
  description = EXCLUDED.description,
  enabled     = true;

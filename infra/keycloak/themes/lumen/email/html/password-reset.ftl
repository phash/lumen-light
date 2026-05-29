<#import "template.ftl" as layout>
<@layout.emailLayout>
<p style="margin:0 0 14px;"><#if user?? && (user.firstName)?has_content>Hallo ${user.firstName},<#else>Hallo,</#if></p>
<p style="margin:0 0 4px;">f&uuml;r dein Lumen-Konto wurde das Zur&uuml;cksetzen des Passworts angefordert. Lege hier ein neues Passwort fest:</p>
<@layout.cta url=link label="Passwort zur&uuml;cksetzen"/>
<p style="margin:0; font-size:13px; color:#78716c;">Der Link ist ${linkExpirationFormatter(linkExpiration)} g&uuml;ltig. Wenn du das nicht angefordert hast, ignoriere diese E-Mail.<br/>
<a href="${link}" target="_blank" style="color:#b45309; word-break:break-all;">${link}</a></p>
</@layout.emailLayout>

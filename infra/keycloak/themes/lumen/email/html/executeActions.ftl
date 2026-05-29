<#import "template.ftl" as layout>
<@layout.emailLayout>
<p style="margin:0 0 14px;"><#if user?? && (user.firstName)?has_content>Hallo ${user.firstName},<#else>Hallo,</#if></p>
<p style="margin:0 0 4px;">willkommen bei Lumen. Schlie&szlig;e die Einrichtung deines Kontos ab &mdash; E-Mail best&auml;tigen und Passwort festlegen:</p>
<@layout.cta url=link label="Konto einrichten"/>
<p style="margin:0; font-size:13px; color:#78716c;">Der Link ist ${linkExpirationFormatter(linkExpiration)} g&uuml;ltig. Falls der Button nicht funktioniert, &ouml;ffne diese Adresse im Browser:<br/>
<a href="${link}" target="_blank" style="color:#b45309; word-break:break-all;">${link}</a></p>
</@layout.emailLayout>

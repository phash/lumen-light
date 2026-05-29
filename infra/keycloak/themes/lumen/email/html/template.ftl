<#macro emailLayout>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
</head>
<body style="margin:0; padding:0; background:#f5f5f4; font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif; color:#1c1917;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f4; padding:24px 12px;">
<tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%; max-width:520px; background:#ffffff; border:1px solid #e7e5e4; border-radius:12px; overflow:hidden;">
<tr><td style="background:#1c1917; padding:20px 28px;">
<span style="font-size:20px; font-weight:600; color:#fcd34d;">Lumen</span><span style="font-size:20px; font-weight:600; color:#e7e5e4;">&nbsp;&middot;&nbsp;light</span>
</td></tr>
<tr><td style="padding:28px; font-size:15px; line-height:1.6; color:#292524;">
<#nested>
</td></tr>
<tr><td style="padding:18px 28px; background:#fafaf9; border-top:1px solid #e7e5e4; font-size:12px; line-height:1.5; color:#a8a29e;">
Lumen &middot; light &mdash; selbstgehosteter Foto-Entwickler.<br/>
Du bekommst diese E-Mail, weil diese Adresse f&uuml;r ein Lumen-Konto verwendet wurde. War das nicht du, ignoriere die Nachricht einfach.
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
</#macro>

<#macro cta url label>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr>
<td align="center" style="border-radius:6px; background:#fcd34d;">
<a href="${url}" target="_blank" style="display:inline-block; padding:13px 28px; font-size:14px; font-weight:600; letter-spacing:0.12em; text-transform:uppercase; color:#1c1917; text-decoration:none;">${label}</a>
</td></tr></table>
</#macro>

# Check the App Store Connect API key before a TestFlight build, and say plainly what is wrong.
# usage: ruby .github/scripts/asc-preflight.rb KEY.p8 KEY_ID ISSUER_ID BUNDLE_ID   (API base overridable with ASC_API_BASE)
# Ported from the same account's other app, where a .p8 copied on an iPhone was mangled and failed late at signing.
require 'openssl'; require 'json'; require 'base64'; require 'net/http'; require 'uri'
path, kid, iss, bundle = ARGV
fail_with = ->(msg) { puts "::error::#{msg}"; exit 1 }
key = OpenSSL::PKey.read(File.read(path)) rescue fail_with.("ASC_KEY_P8 is not a readable private key. Re-copy the whole .p8 file.")
begin key.check_key rescue fail_with.("ASC_KEY_P8 is damaged: its private and public halves do not match (a character changed while copying). Make a new key and copy the .p8 on a computer.") end
puts "key file: OK (private and public parts match)"
fail_with.("ASC_KEY_ID looks wrong: it should be 10 letters/digits (got #{kid.to_s.length} characters).") unless kid.to_s =~ /\A[A-Z0-9]{10}\z/
fail_with.("ASC_ISSUER_ID looks wrong: it should look like 1a2b3c4d-1234-5678-9abc-1a2b3c4d5e6f.") unless iss.to_s =~ /\A\h{8}-\h{4}-\h{4}-\h{4}-\h{12}\z/
b64 = ->(s) { Base64.urlsafe_encode64(s, padding: false) }
now = Time.now.to_i
input = b64.(JSON.dump(alg: 'ES256', kid: kid, typ: 'JWT')) + '.' + b64.(JSON.dump(iss: iss, iat: now, exp: now + 600, aud: 'appstoreconnect-v1'))
r, s = OpenSSL::ASN1.decode(key.sign('SHA256', input)).value.map { |v| v.value.to_s(2).rjust(32, "\0") }
jwt = input + '.' + b64.(r + s)
base = ENV['ASC_API_BASE'] || 'https://api.appstoreconnect.apple.com'
uri = URI("#{base}/v1/apps?filter[bundleId]=#{bundle}&fields[apps]=bundleId,name")
begin
  res = Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == 'https', open_timeout: 20, read_timeout: 30) { |h| h.get(uri.request_uri, 'Authorization' => "Bearer #{jwt}") }
rescue StandardError => e
  puts "::warning::Could not reach App Store Connect to check the key (#{e.class}); carrying on with the build."; exit 0
end
case res.code.to_i
when 200
  apps = JSON.parse(res.body)['data'] || []
  fail_with.("The key works, but no app with bundle ID #{bundle} exists in App Store Connect. Register the App ID (developer.apple.com > Identifiers > +), then App Store Connect > Apps > + > New App (docs/IOS-APP.md).") if apps.empty?
  puts "App Store Connect: key accepted, app found (#{apps[0]['attributes']['name']})"
when 401
  fail_with.("Apple rejected the key (401). In App Store Connect > Users and Access > Integrations > Team Keys check: the key is Active; ASC_KEY_ID is its Key ID; ASC_ISSUER_ID is the Issuer ID above the list; ASC_KEY_P8 is that same key's .p8.")
when 403
  fail_with.("The key works but lacks permission (403). Make a new Team key with Admin access.")
else
  fail_with.("Unexpected answer from App Store Connect: HTTP #{res.code}. #{res.body.to_s[0, 300]}")
end

# Revoke the Apple Development certificates that TestFlight builds leave behind.
# usage: ruby .github/scripts/asc-dev-certs.rb KEY.p8 KEY_ID ISSUER_ID   (API base overridable with ASC_API_BASE)
# Each build runs on a fresh GitHub Mac: automatic signing (-allowProvisioningUpdates with the API key) makes a new
# development certificate there, and its private key is thrown away with the Mac, so the certificate is useless after
# the run. Apple caps them (in another project of the same account, build 28 failed on 15 Oct 2026 with "reached the
# maximum number of certificates").
# Only development certificates made through the API ("Created via API") are revoked; ones made in Xcode on a Mac,
# and every distribution certificate, are left alone. Never fails the build: problems are warnings.
require 'openssl'; require 'json'; require 'base64'; require 'net/http'; require 'uri'
path, kid, iss = ARGV
key = OpenSSL::PKey.read(File.read(path))
b64 = ->(s) { Base64.urlsafe_encode64(s, padding: false) }
now = Time.now.to_i
input = b64.(JSON.dump(alg: 'ES256', kid: kid, typ: 'JWT')) + '.' + b64.(JSON.dump(iss: iss, iat: now, exp: now + 600, aud: 'appstoreconnect-v1'))
r, s = OpenSSL::ASN1.decode(key.sign('SHA256', input)).value.map { |v| v.value.to_s(2).rjust(32, "\0") }
jwt = input + '.' + b64.(r + s)
base = ENV['ASC_API_BASE'] || 'https://api.appstoreconnect.apple.com'
api = lambda do |method, req_path|
  u = URI("#{base}#{req_path}")
  Net::HTTP.start(u.host, u.port, use_ssl: u.scheme == 'https', open_timeout: 20, read_timeout: 30) do |h|
    req = (method == :delete ? Net::HTTP::Delete : Net::HTTP::Get).new(u.request_uri)
    req['Authorization'] = "Bearer #{jwt}"
    h.request(req)
  end
end
begin
  res = api.(:get, '/v1/certificates?limit=200&fields[certificates]=name,displayName,certificateType,expirationDate')
  unless res.code.to_i == 200
    puts "::warning::Could not list certificates (HTTP #{res.code}): #{res.body.to_s[0, 200]}"; exit 0
  end
  certs = JSON.parse(res.body)['data'] || []
  certs.each { |c| a = c['attributes']; puts "certificate: #{a['certificateType']} | #{a['displayName']} | #{a['name']} | expires #{a['expirationDate'].to_s[0, 10]}" }
  dev = certs.select { |c| a = c['attributes']; a['certificateType'].to_s =~ /DEVELOPMENT/ && "#{a['name']} #{a['displayName']}" =~ /Created via API/i }
  puts "development certificates made by builds: #{dev.length}"
  dev.each do |c|
    d = api.(:delete, "/v1/certificates/#{c['id']}")
    puts d.code.to_i == 204 ? "revoked #{c['attributes']['name']} (#{c['id']})" : "::warning::could not revoke #{c['id']}: HTTP #{d.code}"
  end
rescue StandardError => e
  puts "::warning::Certificate clean-up skipped (#{e.class}: #{e.message})"
end

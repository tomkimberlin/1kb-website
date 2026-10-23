# Saved certificate encodings

These standard Brotli streams encode two exact public TLS 1.3 Certificate bodies. Filenames hash the decoded body; `brotliSha256` in each sidecar hashes the encoded stream. They are optional cache data, separate from the page body and deployed encoder.

The main-host payload is 1,486 B; `www` is 1,490 B. Complete CompressedCertificate messages add 12 B. The [October 23 deployment](../../measurements/deployment-20261023-certificate.json) verifies these exact streams were loaded. Renewed certificates have different input hashes and retain ordinary compression.

The sidecars preserve the original Darwin producer, model, parameter and source hashes. Their `producerManifest` paths describe retained build artifacts, not files installed on the server. Native library hashes are historical identities; no native library is shipped here.

To regenerate in scratch, start from the pinned Brotli 1.2.1 recipe in [the baseline optimizer](https://github.com/tomkimberlin/1kb-website/blob/299a921b7b42baab9a0d7004fa9d7fa650a037a7/tools/optimize-certificates.py). Apply only the main model's histogram streak change from 1,536 to 1,280, or the `www` model's literal-cost scale from `0.9f` to `0.88f`, then use that sidecar's encoder parameters. The saved stream supplies its exact decoded input. Rebuilt native library hashes may differ; reproduced compressed bytes must match the saved payload hash.

Run `python3 tools/test_saved_certificates.py` with [the Python dependencies](../../tools/gallery-requirements.txt) installed to check complete decoding, Certificate framing and hashes. Install only the selected `.br`/`.json` pair under the existing certificate locks, preserve original ownership/modes, retain backups, test nginx and verify the actually served component. The [hosting guide](../../server/README.md#certificates-and-dns) covers the existing cache and fallback.

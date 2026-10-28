# Fixed Brotli test inputs

Both streams decode to `../comparison-split/index.html`. `candidate.br` is the
391-byte two-swap stream, SHA-256
`fa488bbf1bc3bd9d07be9d1030d06eb7632c3523396b4ef09780594edb704786`.
`tied.br` is a 392-byte stream using only the literal-tree swap, SHA-256
`6aa8410354437bdba0402266f044510d438709607cdc3aa5ccad7e09257a7563`.
It differs from the 392-byte stock stream and exercises the build's tie rule.
These immutable test inputs make no deployment or live-measurement claim.

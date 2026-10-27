# Split-state test inputs

These are fixed copies of the local candidate's four built representations,
used only to exercise the comparison checker without a candidate Git commit
or a dependency on the current working build. They do not assert deployment,
network verification or a new transport measurement. The test constructs and
discards all future-looking deployment records and hashes in a temporary Git
repository.

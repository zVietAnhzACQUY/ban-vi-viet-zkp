pragma circom 2.2.3;
include "circomlib/circuits/poseidon.circom";

// Test harness only; not a third product circuit and never set up for proofs.
template RequestHashVector() {
    signal input values[6];
    signal input expected;
    component hash = Poseidon(6);
    for (var i = 0; i < 6; i++) hash.inputs[i] <== values[i];
    hash.out === expected;
}
component main {public [expected]} = RequestHashVector();

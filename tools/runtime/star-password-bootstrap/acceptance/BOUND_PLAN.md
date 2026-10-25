# Supported bound UFunction candidate

This candidate is staged only. All first/readonly/trace/classified freezes and
actual run receipts remain immutable. No bound native invocation is approved.

Official exact8333063595fa3c49ad307f3b0f732accbb760d25 source now proves a
specific marker mismatch: LuaUObject.cpp117 tests derives_from_function() when
an object-first CallFunction receives its UFunction second. LuaUFunction.hpp75
overrides derives_from_ufunction(), while inherited derives_from_function()
remains false. LuaMadeSimple.hpp752 consumes userdata by default, and the explicit
preserve_stack=true peek does not fix that marker mismatch. This source deduction
does not establish that an earlier observed unknown error came from this branch.

The bound route is source-supported: FunctionPusher in LuaUObject.cpp1443 creates
UFunction userdata with its owning object; LuaUFunction.cpp30 stores m_base(base).
Its callable metamethod65-69 delegates to the SAME call_ufunction_from_lua.
That marshaler's first-UFunction branch chooses the actual function and get_base()
owning context directly, bypassing the mismatched second-userdata marker. The
single call change is item.method(item.value). No SDK/offset, parameter layout,
function signature, UObject lifespan or encrypted-password format is invented.

New official source provenance is artifacts/star-binding-deep-source.json.
The exact Git tree shows LuaMadeSimple is vendored, NOT a gitlink/submodule:
tree9b1659609ba2504949ab73d29a593c09f68c145b under the pinned833 commit. Every
source has commit URL, SHA256, Git blob SHA1, byte count and archive; MIT notices
are archived. No moving HEAD or binary/runtime/game acquisition occurred.

The cached exact UStruct wrapper does expose ForEachProperty, XProperty exposes
GetClass, and XFieldClass exposes GetFName. However the exposed UFunction wrapper
has no GetNumParms and Property has no property-flags getter. Counting all fields
would not prove native parameter arity or distinguish CPF_Parm/ReturnParm. A
metadata-only field-count probe is weaker than this directly justified bound
route, so it is not proposed as another equivalent boot.

test-bound-source.py compiles exact extracted C++ marker/get_base methods in a
minimal standalone model, and verifies FunctionPusher/context/marshaler source
contracts. It proves the source marker distinction, not game behavior. Bound
engine mocks make legacy object-first calls fail and test full packet semantics,
all-method validation before mutation, invalid second method with zero calls,
secret exceptions, fixed classifier output and transactional cleanup/restoration.

The unique bound driver/controller retains private randomFD input, all known
secret audits, source/archive pins, no published ports, false world/load controls,
75s SIGINT/90s child/105s host bounds, original mod/config restoration, one-use
receipts and child raw versus wrapper outcome. All four earlier containers must
be stopped. Only actual native JSON plus plaintext audits could establish file
generation; method return still does not prove authentication or gameplay.

Offline freeze: node tools/runtime/star-password-bootstrap/acceptance/bound-freeze.mjs.
Review only: node tools/runtime/star-password-bootstrap/acceptance/bound-controller.mjs review.

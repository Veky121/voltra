# Source-only FString and callback review

The observed bound process exited3 with an access-violation marker after the
player call entered and both files appeared. Admin returned; player return is
unproven. File creation, source models and wrapper exit0 do not prove safe native
completion or authentication. No further native invocation occurs in this review.

Exact833 StrProperty return handling calls FString::construct on the reflected
return field. LuaUnrealString.hpp18-19 constructs LocalObject storage using an
UnrealStringType copy of the pointed-to return value. LuaMadeSimple LocalObject
owns m_local_storage, and transfer_stack_object placement-news the wrapper into
userdata. The automatic __gc calls its type destructor. Therefore the claim that
the Lua return wrapper simply retains a pointer into the marshaler's alloca
params is not supported. The real FString allocator/copy/destructor behavior is
still needed to rule out implementation defects; a mock deep-copy cannot do it.

The Unreal gitlink at this exact build is
fbb4fdd3fffc59d5b5268b23a643f500f702115e. Both official repository spellings
return404 for its public source. No moving version or unrelated FString ABI was
substituted. The exact public string wrappers and MIT notice are archived with
SHA256/Git blob provenance in artifacts/star-fstring-deep-source.json.

The marshaler's DeferFree only frees raw heap params and does not explicitly
destroy nested FString property values. That supports a possible cleanup leak,
not a demonstrated double-free or this crash. No guessed destructor call or
manual reflected layout is proposed.

The generic RemoteObject IsValid is pointer-only, but the selected UObjectBase
override checks nonnull/nonspecial, global object-map membership and unreachable
state. UFunction derives UObjectBase and receives that stronger override too.
Neither check is a strong lifetime pin. Earlier blanket pointer-only wording was
incorrect and is superseded by this exact metatable review.

Callback dispatch moves pending actions out before executing them and guards
m_is_currently_executing_game_action, deferring recursive actions. Function refs
are unref'ed after call_function returns. The hook coroutine has a persistent
registry reference. An immediate recursive callback/use-after-free explanation
is therefore not established by the inspected source either.

A concrete future lifetime differentiator would privately retain the admin call's
return in a local table through the second call, without inspecting/stringifying
or exporting it. Discarding it permits GC before the second allocation; retaining
it prevents that collection boundary. The stock-Lua fixture demonstrates this
reference behavior only, not an Unreal defect or a reason to run another trial.
No such native driver is staged here. Any root-reviewed experiment must first
preserve both existing native files byte-for-byte and include the corrected
independent plaintext audit and pretrial random commitments. Previous unknown
passwords cannot be recovered or retrospectively audited.

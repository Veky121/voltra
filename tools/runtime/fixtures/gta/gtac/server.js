"use strict";
let restored = loadTextFile("marker.txt");
if (restored !== null) {
    if (restored !== "517077") throw new Error("Unexpected persisted marker");
    console.log("VOLTRA_GTAC_RESTORED_517077");
}
saveTextFile("marker.txt", "517077");
console.log("VOLTRA_GTAC_SAVED_517077");
addEventHandler("OnResourceStop", function(event, resource) {
    if (resource === thisResource) {
        saveTextFile("marker.txt", "517077");
        console.log("VOLTRA_GTAC_SHUTDOWN_517077");
    }
});

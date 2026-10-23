// SPDX-License-Identifier: MIT
// Voltra server lifecycle adapter through the publisher's custom C# hook.
// Uses only fixed private files. No external request or network listener.
using System.Collections;
using System.Text;
using UnityEngine;
using Teal;

public class VoltraPanelLifecycle : MonoBehaviour
{
    IEnumerator Start()
    {
        if (!Net.IsDedicated) yield break;
        // No operator-controlled path, URI, or scheme is accepted.
        string root = Application.dataPath + "/../.voltra/soldat2/";
        byte[] initial = FilePathName.Instance.ReadFileToBytes(root + "launch-token");
        if (initial == null) { Debug.LogError("VOLTRA_LIFECYCLE_TOKEN_ERROR"); yield break; }
        string token = Encoding.UTF8.GetString(initial).Trim();
        if (token.Length != 32) { Debug.LogError("VOLTRA_LIFECYCLE_TOKEN_INVALID"); yield break; }
        foreach (char c in token)
            if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) yield break;
        Debug.Log("VOLTRA_LIFECYCLE_READY");
        while (Net.IsDedicated)
        {
            byte[] request = FilePathName.Instance.ReadFileToBytes(root + "stop-request");
            if (request != null && Encoding.UTF8.GetString(request).Trim() == "stop:" + token)
            {
                Debug.Log("VOLTRA_NATIVE_QUIT_REQUEST " + token);
                Application.Quit();
                yield break;
            }
            yield return new WaitForSecondsRealtime(0.25f);
        }
    }
}

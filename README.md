<h1 align="center">Bisect</h1>
<p align="center">Inspect and trace your agent's memory.</p>
<p align="center">
  <img alt="Bisect chat" width="100%" src="./assets/readme/bisect-chat.png">
</p>
<p align="center">
  <img alt="Bisect memory trace" width="100%" src="./assets/readme/bisect-trace.png">
</p>

Select text in the agent's reply and click **Trace memory** to find a matching memory. Bisect searches saved memory snapshots to find where it first appeared and shows the original message.

Each successful chat turn saves your full message as a memory and takes a snapshot of all memories. You can browse your saved messages in the **Memories** tab. Corrections stay alongside earlier messages.

If no match is found, the trace stops. The reply may come from general model knowledge or reasoning, or the memory matching step may have missed a relevant memory. A trace shows the source of stored context; it doesn't prove why the model gave a particular answer.

#### License

<sup>
Licensed under <a href="LICENSE">MIT license</a>.
</sup>
<br>
<sup>
Any contribution intentionally submitted for inclusion in this repository by you shall be licensed
under the MIT License, without any additional terms or conditions.
</sup>

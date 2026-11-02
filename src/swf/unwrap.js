// Un-wrap the real game SWF from the `Transformice.swf` loader.
//
// The file served by transformice.com is a loader: the game is stored as DefineBinaryData chunks and the loader's
// obfuscated script writes them into a ByteArray in a fixed but shuffled order. Like TFMRecords/server-string we run
// that script in a tiny AVM2 interpreter that implements only the opcodes the loader uses (anything else throws),
// record the order of the `ByteArray.writeBytes` calls and concatenate the chunks. No Java or external binaries.

import { AbcReader, parseAbc } from "./abc.js";
import { swfBody } from "./reader.js";

class AsObject {
  constructor(props) { this.props = props ?? new Map(); }
}
class AsClass extends AsObject {
  constructor(name) { super(); this.name = name; }
}
class NativeFn {
  constructor(fn) { this.fn = fn; }
}

/** An inert value: callable, and every property read or call result is again inert. */
function stubFn() {
  const fn = new NativeFn(() => {
    const o = new AsObject();
    o.stub = true;
    return o;
  });
  fn.stub = true;
  return fn;
}

/** Walk the tags of a SWF body (after the header) and return the ones the unwrapper needs. */
function scanTags(buf) {
  const body = swfBody(buf);
  let off = Math.ceil((5 + 4 * (body[0] >> 3)) / 8) + 4;
  const abcs = [];
  const binaries = new Map();
  let symbols = [];
  while (off + 2 <= body.length) {
    const header = body.readUInt16LE(off);
    const code = header >> 6;
    let length = header & 0x3f;
    off += 2;
    if (length === 0x3f) { length = body.readUInt32LE(off); off += 4; }
    const data = body.subarray(off, off + length);
    off += length;
    if (code === 0) break;
    if (code === 82) {
      const r = new AbcReader(data, 4);
      while (data[r.pos] !== 0) r.pos++;
      abcs.push(data.subarray(r.pos + 1));
    } else if (code === 76) {
      const count = data.readUInt16LE(0);
      let p = 2;
      for (let i = 0; i < count; i++) {
        const id = data.readUInt16LE(p);
        let e = p + 2;
        while (data[e] !== 0) e++;
        symbols.push({ id, name: data.toString("utf8", p + 2, e) });
        p = e + 1;
      }
    } else if (code === 87) {
      binaries.set(data.readUInt16LE(0), data.subarray(6));
    }
  }
  return { abcs, binaries, symbols };
}

class Vm {
  constructor(abc) {
    this.abc = abc;
    this.writes = [];
    this.classes = new Map();
    for (const inst of abc.instances) this.classes.set(inst.name, new AsClass(inst.name));
    this.global = new AsObject();
    this.byteArrayClass = new AsClass("flash.utils.ByteArray");
    this.globalFns = new Map([
      ["getDefinitionByName", new NativeFn((_t, [name]) => (name === "flash.utils.ByteArray" ? this.byteArrayClass : this.stubClass(String(name))))],
    ]);
  }

  /** Classes the loader touches only to hand the finished SWF to the Flash player (Loader, String): inert stubs. */
  stubClass(name) {
    const cls = new AsClass(name);
    cls.stub = true;
    return cls;
  }

  getProp(obj, name) {
    if ((obj instanceof AsObject || obj instanceof NativeFn) && obj.stub) return stubFn();
    if (typeof obj === "string") {
      if (name === "split") return new NativeFn((self, [sep]) => (sep === "" ? [...self] : self.split(sep)));
      if (name === "length") return obj.length;
    } else if (Array.isArray(obj)) {
      return obj[Number(name)];
    } else if (obj instanceof AsObject) {
      if (name === "writeBytes" && obj.isByteArray) {
        return new NativeFn((_t, [chunk]) => { this.writes.push(chunk.className ?? chunk.name); });
      }
      if (name === "clear" && obj.isByteArray) return new NativeFn(() => undefined);
      return obj.props.get(String(name));
    }
    throw new Error(`AVM: cannot read property ${String(name)} of ${typeof obj}`);
  }

  call(fn, self, args) {
    if (fn instanceof NativeFn) return fn.fn(self, args);
    if (fn && fn.method !== undefined) return this.run(fn.method, self, args);
    throw new Error(`AVM: call of a non-function (${typeof fn}: ${String(fn?.constructor?.name)})`);
  }

  methodTable(inst) {
    const table = new Map();
    for (const t of inst.traits) {
      if (t.kind >= 1 && t.kind <= 3) table.set(this.abc.multinames[t.name].name, { method: t.method });
    }
    return table;
  }

  /** Run the class initializer and return the object the instance constructor then sees as `this`. */
  newInstance(classIndex) {
    const { abc } = this;
    const inst = abc.instances[classIndex];
    const cls = this.classes.get(inst.name);
    this.run(abc.classes[classIndex].init, cls, []);
    const self = new AsObject(new Map([...cls.props, ...this.methodTable(inst)]));
    for (const [k, v] of this.classes) self.props.set(k, v);
    self.props.set("addChild", new NativeFn(() => undefined));
    this.run(inst.init, self, []);
    return self;
  }

  run(methodIndex, self, args) {
    const { abc } = this;
    const body = abc.bodies.get(methodIndex);
    if (!body) throw new Error(`AVM: method ${methodIndex} has no body`);
    const code = body.code;
    const locals = [self, ...args];
    const stack = [];
    const scope = [];
    const r = new AbcReader(code);
    const mn = (i) => abc.multinames[i];
    const popName = (m) => (m.runtimeName ? stack.pop() : m.name);
    const lookupScope = (name) => {
      for (let i = scope.length - 1; i >= 0; i--) {
        const o = scope[i];
        if (o instanceof AsObject && o.props.has(name)) return o;
      }
      if (this.classes.has(name)) return this.global;
      if (this.globalFns.has(name)) return this.global;
      return undefined;
    };
    while (r.pos < code.length) {
      const op = r.u8();
      switch (op) {
        case 0x02: case 0x09: break;
        case 0x08: r.u30(); break;
        case 0x1d: scope.pop(); break;
        case 0x20: stack.push(null); break;
        case 0x21: stack.push(undefined); break;
        case 0x24: stack.push((r.u8() << 24) >> 24); break;
        case 0x25: stack.push(r.u30()); break;
        case 0x26: stack.push(true); break;
        case 0x27: stack.push(false); break;
        case 0x29: stack.pop(); break;
        case 0x2a: stack.push(stack[stack.length - 1]); break;
        case 0x2c: stack.push(abc.strings[r.u30()]); break;
        case 0x30: scope.push(stack.pop()); break;
        case 0x41: {
          const argc = r.u30();
          const callArgs = stack.splice(stack.length - argc, argc);
          const receiver = stack.pop();
          const fn = stack.pop();
          stack.push(this.call(fn, receiver, callArgs));
          break;
        }
        case 0x42: {
          const argc = r.u30();
          const callArgs = stack.splice(stack.length - argc, argc);
          const ctor = stack.pop();
          if (ctor === this.byteArrayClass) {
            const ba = new AsObject();
            ba.isByteArray = true;
            stack.push(ba);
          } else if (ctor instanceof AsClass) {
            const instance = new AsObject(new Map(ctor.props));
            instance.className = ctor.name;
            if (ctor.stub) instance.stub = true;
            stack.push(instance);
          } else {
            void callArgs;
            throw new Error("AVM: construct of a non-class");
          }
          break;
        }
        case 0x46: case 0x4f: {
          const m = mn(r.u30());
          const argc = r.u30();
          const callArgs = stack.splice(stack.length - argc, argc);
          const name = popName(m);
          const obj = stack.pop();
          let result;
          if (obj === this.global && this.globalFns.has(name)) {
            result = this.call(this.globalFns.get(name), obj, callArgs);
          } else {
            result = this.call(this.getProp(obj, name), obj, callArgs);
          }
          if (op === 0x46) stack.push(result);
          break;
        }
        case 0x49: { const argc = r.u30(); stack.splice(stack.length - argc, argc); stack.pop(); break; }
        case 0x47: return undefined;
        case 0x48: return stack.pop();
        case 0x58: r.u30(); break;
        case 0x5d: case 0x5e: {
          const m = mn(r.u30());
          const name = popName(m);
          stack.push(lookupScope(name) ?? scope[0]);
          break;
        }
        case 0x60: {
          const name = popName(mn(r.u30()));
          const holder = lookupScope(name);
          if (!holder) throw new Error(`AVM: ${name} is not defined`);
          stack.push(holder === this.global ? this.classes.get(name) ?? this.globalFns.get(name) : holder.props.get(name));
          break;
        }
        case 0x61: case 0x68: {
          const m = mn(r.u30());
          const value = stack.pop();
          const name = popName(m);
          const obj = stack.pop();
          if (!(obj instanceof AsObject)) throw new Error("AVM: property store on a non-object");
          obj.props.set(String(name), value);
          break;
        }
        case 0x62: stack.push(locals[r.u30()]); break;
        case 0x63: locals[r.u30()] = stack.pop(); break;
        case 0x65: stack.push(scope[r.u8()]); break;
        case 0x66: {
          const name = popName(mn(r.u30()));
          stack.push(this.getProp(stack.pop(), name));
          break;
        }
        case 0xa0: { const b = stack.pop(); const a = stack.pop(); stack.push(a + b); break; }
        case 0xd0: case 0xd1: case 0xd2: case 0xd3: stack.push(locals[op - 0xd0]); break;
        case 0xd4: case 0xd5: case 0xd6: case 0xd7: locals[op - 0xd4] = stack.pop(); break;
        default:
          throw new Error(`AVM: unsupported opcode 0x${op.toString(16)} in method ${methodIndex} (the loader changed shape; extend src/swf/unwrap.js)`);
      }
    }
    return undefined;
  }
}

/**
 * Whether a SWF is the Transformice loader (a handful of binary-data chunks plus the script that stitches them).
 * @param {Buffer} buf
 */
export function isLoaderSwf(buf) {
  const { abcs, binaries } = scanTags(buf);
  return abcs.length === 1 && binaries.size > 0;
}

/**
 * Rebuild the real game SWF from the `Transformice.swf` loader by emulating its script.
 * @param {Buffer} loader contents of https://www.transformice.com/Transformice.swf
 * @returns {{swf:Buffer, order:string[]}} the concatenated SWF and the chunk class names in write order
 */
export function unwrapLoaderSwf(loader) {
  const { abcs, binaries, symbols } = scanTags(loader);
  if (abcs.length !== 1) throw new Error(`unwrap: expected one DoABC tag, found ${abcs.length}`);
  const abc = parseAbc(abcs[0]);
  const vm = new Vm(abc);
  const mainSymbol = symbols.find((s) => s.id === 0)?.name;
  let classIndex = abc.instances.findIndex((i) => i.name === mainSymbol);
  if (classIndex < 0) classIndex = 0;
  vm.newInstance(classIndex);
  const order = vm.writes;
  if (!order.length) throw new Error("unwrap: the loader script wrote no chunks");
  const idByName = new Map(symbols.map((s) => [s.name, s.id]));
  const parts = order.map((name) => {
    const data = binaries.get(idByName.get(name));
    if (!data) throw new Error(`unwrap: no binary data for ${name}`);
    return data;
  });
  return { swf: Buffer.concat(parts), order };
}

/**
 * SWFs embedded as binary data inside another SWF (the game client carries its graphics libraries this way).
 * @param {Buffer} swf
 * @returns {Array<{id:number, name:string|undefined, data:Buffer}>}
 */
export function embeddedSwfs(swf) {
  const { binaries, symbols } = scanTags(swf);
  const out = [];
  for (const [id, data] of binaries) {
    const sig = data.toString("latin1", 0, 3);
    if (sig === "CWS" || sig === "FWS" || sig === "ZWS") out.push({ id, name: symbols.find((s) => s.id === id)?.name, data });
  }
  return out;
}

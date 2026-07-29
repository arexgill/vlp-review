import ast
import json
import sys

def extract_from_ast(files_data):
    routers = {}       # var_name -> prefix
    compositions = {}  # router_var_name -> [prefix1, prefix2] (from include_router)

    # 1. Global pass for routers and include_router
    for f in files_data:
        try:
            tree = ast.parse(f['source'], filename=f['path'])
        except Exception:
            continue

        for node in ast.walk(tree):
            if isinstance(node, ast.Assign):
                # items_router = APIRouter(prefix="/items")
                if isinstance(node.value, ast.Call) and getattr(node.value.func, 'id', None) == 'APIRouter':
                    prefix = ""
                    for kw in node.value.keywords:
                        if kw.arg == 'prefix':
                            if isinstance(kw.value, ast.Str):
                                prefix = kw.value.s
                            elif hasattr(ast, 'Constant') and isinstance(kw.value, getattr(ast, 'Constant')):
                                prefix = kw.value.value

                    for target in node.targets:
                        if isinstance(target, ast.Name):
                            routers[target.id] = prefix

            elif isinstance(node, ast.Expr) and isinstance(node.value, ast.Call):
                # app.include_router(items_router, prefix="/api/v1")
                call = node.value
                if isinstance(call.func, ast.Attribute) and call.func.attr == 'include_router':
                    if call.args and isinstance(call.args[0], ast.Name):
                        router_name = call.args[0].id
                        prefix = ""
                        for kw in call.keywords:
                            if kw.arg == 'prefix':
                                if isinstance(kw.value, ast.Str):
                                    prefix = kw.value.s
                                elif hasattr(ast, 'Constant') and isinstance(kw.value, getattr(ast, 'Constant')):
                                    prefix = kw.value.value
                        if router_name not in compositions:
                            compositions[router_name] = []
                        compositions[router_name].append(prefix)

    # 2. Extract routes and docs
    all_units = []
    all_routes = []
    all_diagnostics = []

    scalar_types = {'int', 'str', 'float', 'bool', 'bytes'}
    ignore_types = {'Request', 'Response', 'BackgroundTasks', 'Session'}

    for f in files_data:
        file_path = f['path']
        try:
            tree = ast.parse(f['source'], filename=file_path)
        except SyntaxError as e:
            all_diagnostics.append({
                "file": file_path,
                "line": e.lineno,
                "message": f"SyntaxError: {e.msg}"
            })
            continue
        except Exception as e:
            all_diagnostics.append({
                "file": file_path,
                "line": 0,
                "message": f"Error: {str(e)}"
            })
            continue

        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                for decorator in node.decorator_list:
                    if isinstance(decorator, ast.Call) and isinstance(decorator.func, ast.Attribute):
                        method = decorator.func.attr

                        if method in ('get', 'post', 'put', 'patch', 'delete', 'api_route'):
                            router_name = None
                            if isinstance(decorator.func.value, ast.Name):
                                router_name = decorator.func.value.id

                            route_path = ""
                            if decorator.args:
                                if hasattr(ast, 'Constant') and isinstance(decorator.args[0], getattr(ast, 'Constant')):
                                    route_path = decorator.args[0].value
                                elif isinstance(decorator.args[0], ast.Str):
                                    route_path = decorator.args[0].s

                            # Resolve prefixes
                            router_prefix = routers.get(router_name, "")
                            comp_prefixes = compositions.get(router_name, [""])

                            for comp_prefix in comp_prefixes:
                                full_path = comp_prefix + router_prefix + route_path
                                # Cleanup double slashes
                                full_path = '/' + '/'.join(x for x in full_path.split('/') if x)
                                if not full_path:
                                    full_path = '/'

                                status_code = None
                                response_model = None
                                api_route_methods = None
                                decorator_dependencies = []

                                for kw in decorator.keywords:
                                    if kw.arg == 'status_code':
                                        if hasattr(ast, 'Constant') and isinstance(kw.value, getattr(ast, 'Constant')):
                                            status_code = kw.value.value
                                        elif isinstance(kw.value, ast.Num):
                                            status_code = kw.value.n
                                    elif kw.arg == 'response_model':
                                        if isinstance(kw.value, ast.Name):
                                            response_model = kw.value.id
                                        elif isinstance(kw.value, ast.Attribute):
                                            response_model = kw.value.attr
                                    elif kw.arg == 'methods':
                                        if isinstance(kw.value, (ast.List, ast.Tuple, ast.Set)):
                                            api_route_methods = []
                                            for elt in kw.value.elts:
                                                if hasattr(ast, 'Constant') and isinstance(elt, getattr(ast, 'Constant')):
                                                    api_route_methods.append(str(elt.value).upper())
                                                elif isinstance(elt, ast.Str):
                                                    api_route_methods.append(elt.s.upper())
                                    elif kw.arg == 'dependencies':
                                        if isinstance(kw.value, (ast.List, ast.Tuple)):
                                            for elt in kw.value.elts:
                                                if isinstance(elt, ast.Call) and getattr(elt.func, 'id', None) == 'Depends':
                                                    if elt.args and isinstance(elt.args[0], ast.Name):
                                                        decorator_dependencies.append(elt.args[0].id)

                                dependencies = list(decorator_dependencies)
                                request_model = None

                                for arg in node.args.args:
                                    if arg.annotation:
                                        type_name = None
                                        if isinstance(arg.annotation, ast.Name):
                                            type_name = arg.annotation.id
                                        elif isinstance(arg.annotation, ast.Attribute):
                                            type_name = arg.annotation.attr
                                        elif isinstance(arg.annotation, ast.Subscript):
                                            # e.g. List[Item]
                                            inner = getattr(arg.annotation, 'slice', None)
                                            # Python 3.9+ ast.Subscript slice is just the node, Python < 3.9 it's an ast.Index
                                            if hasattr(ast, 'Index') and isinstance(inner, getattr(ast, 'Index')):
                                                inner = inner.value

                                            if isinstance(inner, ast.Name):
                                                type_name = inner.id
                                            elif isinstance(inner, ast.Attribute):
                                                type_name = inner.attr
                                            else:
                                                if hasattr(arg.annotation.value, 'id'):
                                                    type_name = arg.annotation.value.id
                                                elif hasattr(arg.annotation.value, 'attr'):
                                                    type_name = arg.annotation.value.attr

                                        if type_name and type_name not in scalar_types and type_name not in ignore_types:
                                            # distinguish body model parameter
                                            request_model = type_name

                                for default in node.args.defaults:
                                    if isinstance(default, ast.Call) and isinstance(default.func, ast.Name) and default.func.id == 'Depends':
                                        if default.args and isinstance(default.args[0], ast.Name):
                                            dependencies.append(default.args[0].id)

                                route_obj = {
                                    "file": file_path,
                                    "lineStart": node.lineno,
                                    "path": full_path,
                                    "methods": api_route_methods if method == 'api_route' else [method.upper()],
                                    "dependencies": dependencies,
                                    "requestModel": request_model,
                                    "responseModel": response_model,
                                    "statusCode": status_code,
                                    "exceptionHandler": None
                                }
                                all_routes.append(route_obj)

                                # Produce source-linked Python documentation unit for the route
                                docstring = ast.get_docstring(node)
                                if docstring:
                                    doc_id = f"route_{full_path}_{method}"
                                    all_units.append({
                                        "id": doc_id,
                                        "name": node.name,
                                        "content": docstring,
                                        "file": file_path,
                                        "lineStart": node.lineno
                                    })

                        elif method == 'exception_handler':
                            exc_handler = None
                            if decorator.args:
                                if hasattr(ast, 'Constant') and isinstance(decorator.args[0], getattr(ast, 'Constant')):
                                    exc_handler = str(decorator.args[0].value)
                                elif isinstance(decorator.args[0], ast.Num):
                                    exc_handler = str(decorator.args[0].n)
                                elif isinstance(decorator.args[0], ast.Str):
                                    exc_handler = decorator.args[0].s
                                elif isinstance(decorator.args[0], ast.Name):
                                    exc_handler = decorator.args[0].id

                            all_routes.append({
                                "file": file_path,
                                "lineStart": node.lineno,
                                "path": None,
                                "methods": None,
                                "dependencies": [],
                                "requestModel": None,
                                "responseModel": None,
                                "statusCode": None,
                                "exceptionHandler": exc_handler
                            })

    return all_units, all_routes, all_diagnostics

def main():
    input_data = sys.stdin.read()
    if not input_data:
        return

    try:
        data = json.loads(input_data)
    except json.JSONDecodeError:
        print(json.dumps({"error": "Invalid JSON input"}))
        return

    files = data.get("files", [])
    units, routes, diagnostics = extract_from_ast(files)

    output = {
        "units": units,
        "routes": routes,
        "diagnostics": diagnostics
    }
    print(json.dumps(output))

if __name__ == "__main__":
    main()
